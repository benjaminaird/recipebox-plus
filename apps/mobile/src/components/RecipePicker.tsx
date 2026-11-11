// Choosing a recipe from the library, as a sheet.
//
// Shared by the planner and the shopping list, because "pick one of your
// recipes" is the same question wherever it is asked and two of these would
// drift. Search is the whole interface: a library of any size is faster to
// type at than to scroll, and the search text is already built and indexed.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { inputStyle, maxScale, textStyle } from "../theme/fonts";
import { listRecipes } from "../data/db";
import { matches } from "../data/query";
import type { Recipe } from "../data/types";
import { RecipeTile } from "./RecipeTile";

export function RecipePicker({
  visible, onClose, onPick, title = "Choose a recipe", subtitle,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (recipe: Recipe) => void;
  title?: string;
  subtitle?: string;
}) {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const [all, setAll] = useState<Recipe[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!visible) return;
    setQuery("");
    let live = true;
    listRecipes().then((r) => { if (live) setAll(r); }).catch(() => { if (live) setAll([]); });
    return () => { live = false; };
  }, [visible]);

  const visibleRecipes = useMemo(() => {
    if (!all) return [];
    return all.filter((r) => matches(r, { query }));
  }, [all, query]);

  const pick = useCallback((recipe: Recipe) => {
    onPick(recipe);
    onClose();
  }, [onPick, onClose]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: t.space.lg }}>
        <View style={[styles.bar, { paddingHorizontal: t.space.screenGutter }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={[textStyle("sectionTitle"), { color: c.text }]}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={[textStyle("footnote"), { color: c.textSecondary }]}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={12}
            style={{ minHeight: t.minTouch, justifyContent: "center" }}
          >
            <Text style={[textStyle("body"), { color: c.textSecondary }]}>Cancel</Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: t.space.screenGutter, paddingBottom: t.space.md }}>
          <View style={[styles.search, { backgroundColor: c.sunken, borderRadius: t.radius.sm, minHeight: t.minTouch }]}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search your recipes"
              placeholderTextColor={c.textTertiary}
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search your recipes"
              style={[inputStyle("body"), { color: c.text, flex: 1 }]}
            />
          </View>
        </View>

        {!all ? (
          <View style={styles.centre}><ActivityIndicator color={c.textTertiary} /></View>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: t.space.screenGutter,
              paddingBottom: insets.bottom + t.space.xxl,
            }}
          >
            {visibleRecipes.length === 0 ? (
              <Text style={[textStyle("body"), { color: c.textSecondary, paddingTop: t.space.lg }]}>
                {all.length === 0
                  ? "You have no recipes yet. Add one first and it will show up here."
                  : `Nothing matches “${query.trim()}”.`}
              </Text>
            ) : (
              visibleRecipes.map((recipe, i) => (
                <Pressable
                  key={recipe.id}
                  onPress={() => pick(recipe)}
                  accessibilityRole="button"
                  accessibilityLabel={recipe.title}
                  style={({ pressed }) => [
                    styles.row,
                    { minHeight: t.minTouch, paddingVertical: t.space.md },
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  {t.largeText ? null : (
                    <RecipeTile title={recipe.title} category={recipe.category} size={44} />
                  )}
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={[textStyle("cardTitle"), { color: c.text }]} numberOfLines={2}>
                      {recipe.title}
                    </Text>
                    {recipe.totalTime || recipe.servings ? (
                      <Text style={[textStyle("footnote"), { color: c.textSecondary }]} numberOfLines={1}>
                        {[recipe.totalTime, recipe.servings ? `Serves ${recipe.servings}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingBottom: 12 },
  search: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
});
