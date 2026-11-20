// What happened to this recipe, and how to undo any of it (ADR 0015).
//
// The list reads as a story rather than a column of timestamps: each row says
// what caused the change in the cook's words — "As it arrived", "Recipe
// Helper", "Kept both versions" — and the bottom of the list is always the
// recipe as it arrived, which is the answer to "what did the source actually
// say?" when a recipe stops working.
//
// Going back does not delete anything. It writes a new version holding the old
// content, so the thing you reverted is still in the list underneath, and
// reverting the revert is just as available. That is the whole reason history
// is append-only, and the screen says so where a cook is about to act on it.

import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Alert, Pressable, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { textStyle } from "../theme/fonts";
import { getRecipe, recipeHistory, recipeVersion, revertRecipe } from "../data/db";
import { causeLabel, type VersionSummary } from "../data/versions";
import type { Recipe } from "../data/types";
import type { RootStackParamList } from "../navigation/types";
import { AuthScreen, Notice, QuietButton } from "./auth/AuthKit";

function when(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${time}`;
}

/** A line of the history, with what it would put back. */
function Row({
  version, current, onRevert,
}: { version: VersionSummary; current: boolean; onRevert: () => void }) {
  const t = useTheme();
  const [title, setTitle] = useState<string | null>(null);

  // The title at that point, read lazily: the list query leaves bodies behind
  // so a long history is cheap, and a row is worth more with the name the
  // recipe had than without it.
  useEffect(() => {
    let live = true;
    void (async () => {
      const full = await recipeVersion(version.recipeId, version.seq);
      if (live) setTitle(full?.recipe.title ?? null);
    })();
    return () => { live = false; };
  }, [version.recipeId, version.seq]);

  return (
    <View
      style={{
        borderColor: t.colors.separator, borderWidth: 1, borderRadius: t.radius.md,
        backgroundColor: current ? t.colors.surfaceRaised : t.colors.surface,
        paddingHorizontal: t.space.md, paddingVertical: t.space.sm, gap: 4,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: t.space.sm }}>
        <Text style={[textStyle("eyebrow"), { color: t.colors.textTertiary }]}>
          {causeLabel(version.cause)}
        </Text>
        {current ? (
          <Text style={[textStyle("eyebrow"), { color: t.colors.accentText }]}>Current</Text>
        ) : null}
      </View>
      {title ? (
        <Text style={[textStyle("cardTitle"), { color: t.colors.text }]}>{title}</Text>
      ) : null}
      {version.note ? (
        <Text style={[textStyle("body"), { color: t.colors.textSecondary }]}>{version.note}</Text>
      ) : null}
      <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>
        {when(version.createdAt)}
      </Text>
      {current ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Go back to this version, from ${when(version.createdAt)}`}
          onPress={onRevert}
          style={{ paddingTop: t.space.xs, minHeight: 36, justifyContent: "center" }}
        >
          <Text style={[textStyle("headline"), { color: t.colors.accentText }]}>Go back to this</Text>
        </Pressable>
      )}
    </View>
  );
}

export function RecipeHistoryScreen() {
  const t = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "RecipeHistory">>();
  const recipeId = route.params.recipeId;

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRecipe(await getRecipe(recipeId));
    setVersions(await recipeHistory(recipeId));
  }, [recipeId]);

  // On focus, because a revert happens here and the list has to show it.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const revert = useCallback((version: VersionSummary) => {
    if (busy) return;
    Alert.alert(
      "Go back to this version?",
      "It becomes the current version. Nothing is deleted: the version you have now stays in this list, so you can come back to it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Go back to it",
          onPress: async () => {
            setBusy(true);
            try {
              await revertRecipe(recipeId, version.seq);
              await load();
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [busy, load, recipeId]);

  if (versions === null) {
    return (
      <AuthScreen title="History">
        <Text style={[textStyle("body"), { color: t.colors.textSecondary }]}>One moment…</Text>
      </AuthScreen>
    );
  }

  if (versions.length === 0) {
    return (
      <AuthScreen title="History" lead={recipe?.title}>
        <Notice message={{
          title: "Nothing recorded yet",
          detail: "This recipe predates the history this phone keeps. From the next change onwards, every version is kept and any of them can be put back.",
          tone: "info",
        }} />
        <QuietButton label="Back" onPress={() => navigation.goBack()} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="History"
      lead={`${versions.length === 1 ? "One version" : `${versions.length} versions`} of ${recipe?.title ?? "this recipe"}, newest first. Nothing here is ever deleted.`}
    >
      <View style={{ gap: t.space.sm }}>
        {versions.map((version, index) => (
          <Row
            key={version.id}
            version={version}
            current={index === 0}
            onRevert={() => revert(version)}
          />
        ))}
      </View>
      <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>
        Going back to a version writes a new one holding its content, so the version you have now stays in this list.
      </Text>
    </AuthScreen>
  );
}
