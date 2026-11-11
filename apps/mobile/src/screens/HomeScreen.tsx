// The app's front door, on the device's own data.
//
// Everything here is read from SQLite: the recipes are the user's library and
// the resumable cooks are real `cook_progress` rows written by Cook Mode. No
// account, no network, no placeholder content dressed as working UI.
//
// Plan and Import are not built. Rather than mime them with empty cards that
// look broken, Home says what is coming in one honest strip at the bottom.
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme/ThemeProvider";
import { maxScale, textStyle } from "../theme/fonts";
import { BrandHeader } from "../components/BrandHeader";
import { RecipeTile } from "../components/RecipeTile";
import { activeSessions, listRecipes } from "../data/db";
import { recentlyAdded, resumableCooks, type ResumableCook } from "../data/query";
import { flattenSteps, type Recipe } from "../data/types";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Dashboard = { recipes: Recipe[]; cooking: ResumableCook[] };

/** "2 days ago" at the resolution a dashboard needs, and no finer. */
function whenLabel(ts: number, now: number): string {
  const mins = Math.max(0, Math.round((now - ts) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function HomeScreen() {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const [data, setData] = useState<Dashboard | null>(null);

  // Re-read on every focus, not once on mount: leaving Cook Mode must change
  // what Home says about the session that was just advanced or finished.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([listRecipes(), activeSessions(3)])
        .then(([recipes, sessions]) => {
          if (live) setData({ recipes, cooking: resumableCooks(recipes, sessions) });
        })
        .catch(() => { if (live) setData({ recipes: [], cooking: [] }); });
      return () => { live = false; };
    }, []),
  );

  if (!data) {
    return (
      <View style={[styles.centre, { backgroundColor: c.canvas }]}>
        <ActivityIndicator color={c.textTertiary} />
      </View>
    );
  }

  const recent = recentlyAdded(data.recipes, 4);
  const now = Date.now();

  return (
    <ScrollView
      style={{ backgroundColor: c.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + t.space.lg,
        paddingBottom: insets.bottom + t.space.huge,
        paddingHorizontal: t.space.screenGutter,
        gap: t.space.xxl,
      }}
    >
      {/* The lockup, with settings at the far end of the same line. A gear in
          the header is where every iOS app puts it, and it keeps the five tabs
          for the five things a cook actually does. */}
      <View style={styles.header}>
        <BrandHeader />
        <Pressable
          onPress={() => navigation.navigate("Settings")}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={12}
          style={({ pressed }) => [
            styles.gear,
            {
              width: t.minTouch,
              height: t.minTouch,
              borderRadius: t.radius.pill,
              backgroundColor: pressed ? c.sunken : "transparent",
            },
          ]}
        >
          <Ionicons name="settings-outline" size={22} color={c.textSecondary} />
        </Pressable>
      </View>

      {/* The page's one bold element, and only when it has earned it.
          Cooking is the activity people are always interrupted during -- it is
          the whole reason Cook Mode saves a place at all -- so a cook who
          opens RecipeBox mid-dish is almost always here to carry on. That
          makes "what am I doing next" the most useful sentence on the screen,
          and it is shown rather than described: the step's own text, not a
          count of steps. Everything below stays deliberately quiet. */}
      {data.cooking.map((cook) => {
        const steps = flattenSteps(cook.recipe);
        const step = steps[cook.stepIndex];
        const done = (cook.stepIndex + 1) / Math.max(cook.totalSteps, 1);
        return (
          <Pressable
            key={cook.recipe.id}
            onPress={() => navigation.navigate("CookMode", { recipeId: cook.recipe.id })}
            accessibilityRole="button"
            accessibilityLabel={`Resume ${cook.recipe.title}, step ${cook.stepIndex + 1} of ${cook.totalSteps}`}
            accessibilityHint={step ? step.text : undefined}
            style={({ pressed }) => [
              styles.resume,
              {
                backgroundColor: c.accentSoft,
                borderRadius: t.radius.lg,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[textStyle("eyebrow"), { color: c.accentText }]}>
              Still cooking · {whenLabel(cook.updatedAt, now)}
            </Text>

            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={maxScale("sectionTitle")}
              style={[textStyle("sectionTitle"), { color: c.text }]}
              numberOfLines={2}
            >
              {cook.recipe.title}
            </Text>

            {step ? (
              <Text style={[textStyle("body"), { color: c.textSecondary }]} numberOfLines={3}>
                {step.text}
              </Text>
            ) : null}

            {/* The same progress bar Cook Mode uses, so the card and the
                screen it opens agree about where the cook is. */}
            <View style={[styles.track, { backgroundColor: c.surface }]}>
              <View
                style={{
                  width: `${Math.min(Math.max(done, 0), 1) * 100}%`,
                  height: "100%",
                  backgroundColor: c.accentText,
                  borderRadius: 999,
                }}
              />
            </View>

            <View style={[styles.resumeFoot, t.largeText && styles.resumeFootStacked]}>
              <Text style={[textStyle("footnote"), { color: c.accentText, flex: t.largeText ? undefined : 1 }]}>
                Step {cook.stepIndex + 1} of {cook.totalSteps}
              </Text>
              <View style={[styles.resumeCta, { backgroundColor: c.accent, borderRadius: t.radius.pill, minHeight: t.minTouch }]}>
                <Text style={[textStyle("headline"), { color: c.onAccent }]}>Resume</Text>
              </View>
            </View>
          </Pressable>
        );
      })}

      <View style={{ gap: t.space.md }}>
        <View style={styles.sectionHead}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={maxScale("sectionTitle")} style={[textStyle("sectionTitle"), { color: c.text, flex: 1 }]}>
            Recently added
          </Text>
          {/* Nothing to see all of, when there is nothing. "All 0" is a link
              that promises a screen and delivers an empty one. */}
          {data.recipes.length > 0 ? (
            <Pressable
              onPress={() => navigation.navigate("Tabs", { screen: "Recipes" })}
              accessibilityRole="button"
              accessibilityLabel={`See all ${data.recipes.length} recipes`}
              hitSlop={10}
              style={{ minHeight: t.minTouch, justifyContent: "center" }}
            >
              <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>
                All {data.recipes.length}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {recent.length === 0 ? (
          // An empty screen is an invitation to act. It says what will happen
          // and offers the thing that makes it happen, rather than reporting
          // a state back to the cook who already knows they have no recipes.
          <Pressable
            onPress={() => navigation.navigate("AddRecipe")}
            accessibilityRole="button"
            accessibilityLabel="Add your first recipe"
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: c.surface,
                borderRadius: t.radius.md,
                padding: t.space.xl,
                gap: t.space.sm,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text style={[textStyle("cardTitle"), { color: c.text }]}>
              Nothing in the box yet
            </Text>
            <Text style={[textStyle("body"), { color: c.textSecondary }]}>
              Paste a recipe, or bring one in from a link or a photo. It stays on this device.
            </Text>
            <Text style={[textStyle("headline"), { color: c.accentText, marginTop: t.space.xs }]}>
              Add a recipe
            </Text>
          </Pressable>
        ) : (
          recent.map((recipe) => (
            <Pressable
              key={recipe.id}
              onPress={() => navigation.navigate("RecipeDetail", { recipeId: recipe.id })}
              accessibilityRole="button"
              accessibilityLabel={`${recipe.title}${recipe.category ? `, ${recipe.category}` : ""}`}
              accessibilityHint="Opens the recipe"
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
            >
              {/* The tile is a fixed-size graphic. At accessibility text sizes
                  it starves the title, which then truncates mid-word; the text
                  is what the row is for, so the tile gives way. */}
              {t.largeText ? null : (
                <RecipeTile title={recipe.title} category={recipe.category} size={64} />
              )}
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text
                  style={[textStyle("cardTitle"), { color: c.text }]}
                  numberOfLines={t.largeText ? undefined : 2}
                >
                  {recipe.title}
                </Text>
                <Text
                  style={[textStyle("footnote"), { color: c.textSecondary }]}
                  numberOfLines={t.largeText ? undefined : 1}
                >
                  {[recipe.totalTime, recipe.servings ? `Serves ${recipe.servings}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </View>

      {/* Still true, still said -- but said quietly and last. An amber badge
          at the foot of Home made the thing that does NOT work the loudest
          element on the page. The honesty was right; the weight was not. */}
      <View style={[styles.footnote, { borderTopColor: c.separator }]}>
        <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
          Planned meals and imports waiting for review will appear here once Plan and Add are
          built.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  // The gear is pulled out into the gutter so the icon's optical edge lines up
  // with the text below it rather than its touch target's edge.
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginRight: -10 },
  gear: { alignItems: "center", justifyContent: "center" },
  card: { overflow: "hidden" },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  // The one card on the page allowed to take up room. Generous padding and a
  // larger radius are what separate it from the quiet rows below; nothing else
  // on Home gets either.
  resume: { padding: 18, gap: 10 },
  track: { height: 4, borderRadius: 999, overflow: "hidden", marginTop: 2 },
  resumeFoot: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 2 },
  resumeFootStacked: { flexDirection: "column", alignItems: "flex-start" },
  resumeCta: { alignItems: "center", justifyContent: "center", paddingHorizontal: 22 },
  row: { flexDirection: "row", gap: 14, alignItems: "center" },
  footnote: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
});
