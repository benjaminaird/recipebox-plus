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
import { textStyle } from "../theme/fonts";
import { RecipeTile } from "../components/RecipeTile";
import { listRecipes } from "../data/db";
import { collectCategories, collectTags, type Recipe } from "../data/types";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function RecipesScreen() {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

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

  const visible = useMemo(() => {
    if (!all) return [];
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (category && r.category !== category) return false;
      if (tag && !(r.tags ?? []).includes(tag)) return false;
      if (!q) return true;
      const hay = [
        r.title, r.description ?? "", r.category ?? "",
        ...(r.tags ?? []),
        ...r.sections.flatMap((s) => s.ingredients.map((i) => i.name)),
      ].join(" ").toLowerCase();
      return q.split(/\s+/).every((term) => hay.includes(term));
    });
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
              <Text accessibilityRole="header" style={[textStyle("largeTitle"), { color: c.text }]}>
                Recipes
              </Text>
              <Text style={[textStyle("subhead"), { color: c.textSecondary, marginTop: t.space.xxs }]}>
                {all === null
                  ? "Opening your library…"
                  : `${all.length} ${all.length === 1 ? "recipe" : "recipes"}, stored on this device`}
              </Text>
            </View>

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search recipes and ingredients"
              placeholderTextColor={c.textTertiary}
              clearButtonMode="while-editing"
              autoCorrect={false}
              accessibilityLabel="Search recipes and ingredients"
              style={[
                textStyle("body"),
                styles.search,
                { backgroundColor: c.sunken, color: c.text, borderRadius: t.radius.sm, minHeight: t.minTouch },
              ]}
            />

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
            <RecipeTile title={item.title} category={item.category} />
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text style={[textStyle("cardTitle"), { color: c.text }]} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={[textStyle("footnote"), { color: c.textSecondary }]} numberOfLines={1}>
                {[item.totalTime, item.servings ? `Serves ${item.servings}` : null].filter(Boolean).join(" · ")}
              </Text>
              {item.tags?.length ? (
                <Text style={[textStyle("footnote"), { color: c.textTertiary }]} numberOfLines={1}>
                  {item.tags.join(" · ")}
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
              <Text style={[textStyle("sectionTitle"), { color: c.text, textAlign: "center" }]}>
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
  chipRow: { gap: 8, paddingRight: 4 },
  chip: { paddingHorizontal: 13, justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", gap: 14, alignItems: "center" },
  empty: { paddingTop: 48, alignItems: "center", justifyContent: "center" },
  clear: { marginTop: 8, paddingHorizontal: 18, justifyContent: "center" },
});
