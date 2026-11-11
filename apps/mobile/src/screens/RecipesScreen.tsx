// The recipe library, read from the device's own SQLite database.
//
// Everything here is local: no account, no network. Search narrows on every
// keystroke against the pre-built search text (title, description, category,
// tags and every ingredient name), so "cannellini" finds the soup.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme/ThemeProvider";
import { inputStyle, maxScale, textStyle } from "../theme/fonts";
import { RecipeTile } from "../components/RecipeTile";
import { listRecipes } from "../data/db";
import { collectCategories, collectTags, type Recipe } from "../data/types";
import { matches } from "../data/query";
import { displayTag } from "../domain/tags";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function RecipesScreen() {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  // The search field scales itself rather than letting the OS do it.
  // TextInput sizes its box from the scaled metrics but lays the placeholder
  // out at the base size and pins it to the bottom, and maxFontSizeMultiplier
  // -- the obvious cap -- stops the placeholder rendering at all. Opting out
  // and setting an explicit, capped size keeps text and placeholder together.
  const searchSize = Math.round((inputStyle("body").fontSize ?? 17) * Math.min(t.fontScale, 1.6));

  const [all, setAll] = useState<Recipe[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);

  // The unfiltered library, loaded once. Filtering a handful of recipes in
  // memory is instant and avoids a round trip on every keystroke; the SQL
  // filters in db.ts are there for when the library outgrows that.
  useEffect(() => {
    let live = true;
    listRecipes()
      .then((rows) => { if (live) setAll(rows); })
      .catch(() => { if (live) setAll([]); });
    return () => { live = false; };
  }, []);

  const categories = useMemo(() => collectCategories(all ?? []), [all]);
  const tags = useMemo(() => collectTags(all ?? []), [all]);

  // One implementation of "does this recipe match", shared with the database
  // path. It had two, and they disagreed: this screen compared tag strings
  // exactly, so a pill reading "Make-Ahead" found nothing on a recipe saved as
  // "Make ahead" -- a filter that silently returns an empty library.
  const visible = useMemo(() => {
    if (!all) return [];
    const filters = { query, category, tags: tag ? [tag] : [] };
    return all.filter((r) => matches(r, filters));
  }, [all, query, category, tag]);

  const open = useCallback(
    (id: string) => navigation.navigate("RecipeDetail", { recipeId: id }),
    [navigation],
  );

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? c.accentSoft : c.surface,
          borderColor: active ? c.accentText : c.separatorStrong,
          borderRadius: 999,
          opacity: pressed ? 0.7 : 1,
          minHeight: 34,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[textStyle("footnote"), { color: active ? c.accentText : c.textSecondary, fontWeight: active ? "600" : "400" }]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <FlatList
        data={visible}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{
          paddingTop: insets.top + t.space.lg,
          paddingBottom: insets.bottom + t.space.huge,
          paddingHorizontal: t.space.screenGutter,
        }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: t.space.lg, marginBottom: t.space.lg }}>
            <View>
              <Text accessibilityRole="header" maxFontSizeMultiplier={maxScale("largeTitle")} style={[textStyle("largeTitle"), { color: c.text }]}>
                Recipes
              </Text>
              <Text style={[textStyle("subhead"), { color: c.textSecondary, marginTop: t.space.xxs }]}>
                {all === null
                  ? "Opening your library…"
                  : `${all.length} ${all.length === 1 ? "recipe" : "recipes"}, stored on this device`}
              </Text>
            </View>

            {/* The placeholder is drawn here rather than by TextInput.
                Constraining the field's font scaling -- by any means:
                allowFontScaling={false} or maxFontSizeMultiplier -- stops iOS
                rendering the native placeholder at accessibility sizes, while
                the typed value lays out correctly. Drawing it ourselves keeps
                both, and the field still owns the accessibility label. */}
            <View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                clearButtonMode="while-editing"
                autoCorrect={false}
                accessibilityLabel="Search recipes and ingredients"
                allowFontScaling={false}
                style={[
                  inputStyle("body"),
                  styles.search,
                  {
                    fontSize: searchSize,
                    backgroundColor: c.sunken,
                    color: c.text,
                    borderRadius: t.radius.sm,
                    minHeight: t.minTouch,
                  },
                ]}
              />
              {query.length === 0 ? (
                <View pointerEvents="none" style={styles.placeholder}>
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={{ fontSize: searchSize, color: c.textTertiary }}
                  >
                    Search recipes and ingredients
                  </Text>
                </View>
              ) : null}
            </View>

            {categories.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
                accessibilityLabel="Filter by category"
              >
                {chip("All", !category && !tag, () => { setCategory(null); setTag(null); })}
                {categories.map((name) => chip(name, category === name, () =>
                  setCategory(category === name ? null : name),
                ))}
              </ScrollView>
            ) : null}

            {tags.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
                accessibilityLabel="Filter by tag"
              >
                {tags.map((name) => chip(name, tag === name, () => setTag(tag === name ? null : name)))}
              </ScrollView>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={() => (
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator, marginVertical: t.space.md }} />
        )}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}${item.category ? `, ${item.category}` : ""}`}
            accessibilityHint="Opens the recipe"
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
          >
            {/* See HomeScreen: the fixed tile yields to the text at
                accessibility sizes rather than truncating it mid-word. */}
            {t.largeText ? null : <RecipeTile title={item.title} category={item.category} />}
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text
                style={[textStyle("cardTitle"), { color: c.text }]}
                numberOfLines={t.largeText ? undefined : 2}
              >
                {item.title}
              </Text>
              <Text
                style={[textStyle("footnote"), { color: c.textSecondary }]}
                numberOfLines={t.largeText ? undefined : 1}
              >
                {[item.totalTime, item.servings ? `Serves ${item.servings}` : null].filter(Boolean).join(" · ")}
              </Text>
              {item.tags?.length ? (
                <Text
                  style={[textStyle("footnote"), { color: c.textTertiary }]}
                  numberOfLines={t.largeText ? undefined : 1}
                >
                  {item.tags.map(displayTag).join(" · ")}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          all === null ? (
            <View style={styles.empty}>
              <ActivityIndicator color={c.textTertiary} />
            </View>
          ) : (
            <View style={[styles.empty, { gap: t.space.sm }]}>
              <Text maxFontSizeMultiplier={maxScale("sectionTitle")} style={[textStyle("sectionTitle"), { color: c.text, textAlign: "center" }]}>
                Nothing matches
              </Text>
              <Text style={[textStyle("body"), { color: c.textSecondary, textAlign: "center" }]}>
                {query.trim()
                  ? `No recipe matches “${query.trim()}”.`
                  : "No recipe matches those filters."}
              </Text>
              <Pressable
                onPress={() => { setQuery(""); setCategory(null); setTag(null); }}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.clear,
                  { backgroundColor: c.accentSoft, borderRadius: 999, opacity: pressed ? 0.7 : 1, minHeight: t.minTouch },
                ]}
              >
                <Text style={[textStyle("headline"), { color: c.accentText }]}>Clear search and filters</Text>
              </Pressable>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: 14, paddingVertical: 10 },
  placeholder: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  chipRow: { gap: 8, paddingRight: 4 },
  chip: { paddingHorizontal: 13, justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", gap: 14, alignItems: "center" },
  empty: { paddingTop: 48, alignItems: "center", justifyContent: "center" },
  clear: { marginTop: 8, paddingHorizontal: 18, justifyContent: "center" },
});
