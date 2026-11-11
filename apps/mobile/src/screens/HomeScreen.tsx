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
import type { Recipe } from "../data/types";
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

      {data.cooking.length > 0 ? (
        <View style={{ gap: t.space.md }}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={maxScale("sectionTitle")} style={[textStyle("sectionTitle"), { color: c.text }]}>
            Still cooking
          </Text>
          {data.cooking.map((cook) => (
            <Pressable
              key={cook.recipe.id}
              onPress={() => navigation.navigate("CookMode", { recipeId: cook.recipe.id })}
              accessibilityRole="button"
              accessibilityLabel={`Resume ${cook.recipe.title}, step ${cook.stepIndex + 1} of ${cook.totalSteps}`}
              // Side by side, "Resume" takes a fixed share of the width and
              // the title is squeezed into a few characters per line once the
              // text is large. Above the threshold the card stacks instead.
              style={({ pressed }) => [
                styles.resume,
                t.largeText && styles.resumeStacked,
                {
                  backgroundColor: c.accentSoft,
                  borderRadius: t.radius.md,
                  minHeight: t.minTouch,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={[textStyle("cardTitle"), { color: c.text }]} numberOfLines={2}>
                  {cook.recipe.title}
                </Text>
                <Text style={[textStyle("footnote"), { color: c.accentText }]}>
                  Step {cook.stepIndex + 1} of {cook.totalSteps} · {whenLabel(cook.updatedAt, now)}
                </Text>
              </View>
              <Text numberOfLines={1} style={[textStyle("headline"), { color: c.accentText }]}>
                Resume
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={{ gap: t.space.md }}>
        <View style={styles.sectionHead}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={maxScale("sectionTitle")} style={[textStyle("sectionTitle"), { color: c.text, flex: 1 }]}>
            Recently added
          </Text>
          <Pressable
            onPress={() => navigation.navigate("Tabs", { screen: "Recipes" })}
            accessibilityRole="button"
            accessibilityLabel="See all recipes"
            hitSlop={10}
            style={{ minHeight: t.minTouch, justifyContent: "center" }}
          >
            <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>
              All {data.recipes.length}
            </Text>
          </Pressable>
        </View>

        {recent.length === 0 ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderRadius: t.radius.md, padding: t.space.lg }]}>
            <Text style={[textStyle("body"), { color: c.textSecondary }]}>
              Your library is empty. Recipes you add live on this device.
            </Text>
          </View>
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

      <View style={{ gap: t.space.sm }}>
        <View style={[styles.badge, { backgroundColor: c.attentionSoft, borderRadius: t.radius.sm }]}>
          <Text style={[textStyle("footnote"), { color: c.attention, fontWeight: "600" }]}>Not built yet</Text>
        </View>
        <Text style={[textStyle("body"), { color: c.textSecondary }]}>
          Today's planned meals and any import still waiting for review will appear here once Plan
          and Add are built.
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
  resume: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  resumeStacked: { flexDirection: "column", alignItems: "flex-start", gap: 8 },
  row: { flexDirection: "row", gap: 14, alignItems: "center" },
  badge: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3 },
});
