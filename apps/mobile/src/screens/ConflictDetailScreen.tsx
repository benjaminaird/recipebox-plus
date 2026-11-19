// One recipe, two versions, and a choice that cannot destroy either by accident.
//
// Three things had to be true for this screen to be honest:
//
//   Both versions are shown, not summarised into a verdict. The summary at the
//   top says where they disagree; the two panels below say what they actually
//   are, because a cook deciding between 250 g and 200 g of flour needs the
//   numbers and not the word "ingredients".
//
//   Every choice is confirmed, and the confirmation says what stops being
//   current — never "delete", because nothing is deleted: the version not
//   chosen stays in this record and in the account's own history (ADR 0015).
//
//   There is no "merge". ADR 0006 rules it out, and the reason is that merging
//   two recipes means guessing which quantities belong together, which is
//   exactly the guess that ruins a dish. "Keep both" is the honest version of
//   what merge is usually reached for.

import { useCallback, useEffect, useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Alert, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { textStyle } from "../theme/fonts";
import { useSync } from "../sync/SyncProvider";
import { differences } from "../sync/difference";
import type { StoredConflict } from "../data/sqliteSyncStore";
import type { ConflictChoice } from "../sync/outbox";
import type { Recipe } from "../data/types";
import type { RootStackParamList } from "../navigation/types";
import { AuthScreen, Notice, Panel, PanelRow, PrimaryButton, QuietButton } from "./auth/AuthKit";

/** One version, as a cook can actually read it. */
function Version({ title, recipe, caption }: { title: string; recipe: Recipe | null; caption: string }) {
  const t = useTheme();
  if (!recipe) {
    return (
      <View style={{ gap: t.space.xs }}>
        <Text accessibilityRole="header" style={[textStyle("sectionTitle"), { color: t.colors.text }]}>{title}</Text>
        <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>
          This version is not on the phone.
        </Text>
      </View>
    );
  }
  const ingredients = (recipe.sections ?? []).flatMap((s) => s.ingredients ?? []);
  const steps = (recipe.sections ?? []).flatMap((s) => s.steps ?? []);
  return (
    <View style={{ gap: t.space.sm }}>
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={[textStyle("sectionTitle"), { color: t.colors.text }]}>{title}</Text>
        <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>{caption}</Text>
      </View>
      <Panel>
        <PanelRow first label="Name" value={recipe.title} />
        <PanelRow
          label="Ingredients"
          detail={ingredients.map((i) => [i.amount, i.unit, i.name].filter(Boolean).join(" ")).join("\n") || "None listed"}
        />
        <PanelRow
          label={steps.length === 1 ? "1 step" : `${steps.length} steps`}
          detail={steps.map((s, n) => `${n + 1}. ${s.text}`).join("\n\n") || "None written"}
        />
      </Panel>
    </View>
  );
}

export function ConflictDetailScreen() {
  const t = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "ConflictDetail">>();
  const sync = useSync();
  const [conflict, setConflict] = useState<StoredConflict | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const all = await sync.openConflicts();
    setConflict(all.find((c) => c.id === route.params.conflictId) ?? null);
  }, [sync, route.params.conflictId]);

  // Loaded once rather than on every focus: coming back from the confirmation
  // should not re-read a conflict that has just been resolved and show it
  // empty for a frame.
  useEffect(() => { void load(); }, [load]);

  const choose = useCallback((choice: ConflictChoice) => {
    if (!conflict || busy) return;
    const prompts: Record<ConflictChoice, { title: string; body: string; verb: string }> = {
      "keep-theirs": {
        title: "Keep the account's version?",
        body: "Your version stops being the current one. It stays in this record, and the account keeps its own history of the recipe, so nothing is thrown away.",
        verb: "Keep the account's",
      },
      "keep-mine": {
        title: "Keep your version?",
        body: "Your version is sent to the account and becomes the current one everywhere. The account's version stays in its history.",
        verb: "Keep mine",
      },
      "keep-both": {
        title: "Keep both?",
        body: "Your version becomes a separate recipe of its own, and the account's stays as it is. You will have two recipes.",
        verb: "Keep both",
      },
    };
    const prompt = prompts[choice];
    Alert.alert(prompt.title, prompt.body, [
      { text: "Cancel", style: "cancel" },
      {
        text: prompt.verb,
        onPress: async () => {
          setBusy(true);
          try {
            await sync.resolveConflict(conflict, choice);
            navigation.goBack();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [conflict, busy, sync, navigation]);

  if (conflict === undefined) {
    return (
      <AuthScreen title="Comparing">
        <Text style={[textStyle("body"), { color: t.colors.textSecondary }]}>One moment…</Text>
      </AuthScreen>
    );
  }

  if (conflict === null) {
    return (
      <AuthScreen title="Already settled">
        <Notice
          message={{
            title: "This one has been decided",
            detail: "Nothing further is waiting on it.",
            tone: "info",
          }}
        />
        <QuietButton label="Back" onPress={() => navigation.goBack()} />
      </AuthScreen>
    );
  }

  const list = differences(conflict.mine, conflict.theirs);
  const name = conflict.mine?.title ?? conflict.theirs?.title ?? "This recipe";

  return (
    <AuthScreen
      title={name}
      lead={`This recipe was changed on this phone and in your account before the two had spoken. Both versions are below.`}
    >
      <Notice
        message={{
          title: list.length === 0
            ? "The two versions read the same"
            : list.length === 1 ? "One difference" : `${list.length} differences`,
          detail: list.length === 0
            ? "They were changed separately, so they could not be combined automatically — but there is nothing to choose between."
            : list.map((d) => "• " + d.text).join("\n"),
          tone: list.some((d) => d.weight === "major") ? "attention" : "info",
        }}
      />

      <Version
        title="Your version"
        recipe={conflict.mine}
        caption="Changed on this phone, and not yet in the account."
      />
      <Version
        title="The account's version"
        recipe={conflict.theirs}
        caption={conflict.serverRevision === null
          ? "What your account holds."
          : `What your account holds, as of change ${conflict.serverRevision}.`}
      />

      <View style={{ gap: t.space.sm }}>
        <PrimaryButton label="Keep the account's version" onPress={() => choose("keep-theirs")} disabled={busy} />
        <QuietButton label="Keep my version" onPress={() => choose("keep-mine")} disabled={busy} />
        <QuietButton label="Keep both, as two recipes" onPress={() => choose("keep-both")} disabled={busy} />
        <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>
          Whichever you choose, the other version stays in your account's history of this recipe and can be put back.
        </Text>
      </View>
    </AuthScreen>
  );
}
