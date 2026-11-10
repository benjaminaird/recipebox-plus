// One recipe, read from the local database.
//
// The ingredient list is the single source of truth and a step carries no
// quantity of its own (ADR 0012); each step's ingredients are resolved from
// its refs at render time, so a step cannot contradict the list. Those refs
// have been written by the importer for a long time and never displayed —
// this is the first screen to read them.
//
// A ref alone does not fix a quantity. Where a recipe divides an ingredient
// across steps, the step's own share is shown; where it divides one without
// saying how, the chip says "total" rather than implying the whole amount
// belongs to that step. The list above keeps the undivided total either way.
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme/ThemeProvider";
import { maxScale, textStyle } from "../theme/fonts";
import { getRecipe } from "../data/db";
import { formatQuantity, stepIngredientUses, useChipLabel, type Recipe, type Source } from "../data/types";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "RecipeDetail">;

/** Attribution line (ADR 0020). Shown for every recipe, never hidden away. */
function sourceLine(source: Source): string {
  if (source.reference) return source.reference;
  const who = source.author;
  const where = source.siteName ?? source.domain;
  if (who && where) return `${who} · ${where}`;
  return who ?? where ?? "Added by hand";
}

export function RecipeDetailScreen() {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();

  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    getRecipe(params.recipeId)
      .then((r) => { if (live) setRecipe(r); })
      .catch(() => { if (live) setRecipe(null); });
    return () => { live = false; };
  }, [params.recipeId]);

  if (recipe === undefined) {
    return (
      <View style={[styles.centre, { backgroundColor: c.canvas }]}>
        <ActivityIndicator color={c.textTertiary} />
      </View>
    );
  }

  if (recipe === null) {
    return (
      <View style={[styles.centre, { backgroundColor: c.canvas, padding: t.space.xxl, gap: t.space.sm }]}>
        <Text maxFontSizeMultiplier={maxScale("sectionTitle")} style={[textStyle("sectionTitle"), { color: c.text }]}>Recipe not found</Text>
        <Text style={[textStyle("body"), { color: c.textSecondary, textAlign: "center" }]}>
          It may have been deleted from this device.
        </Text>
      </View>
    );
  }

  const meta = [recipe.totalTime, recipe.servings ? `Serves ${recipe.servings}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <ScrollView
      style={{ backgroundColor: c.canvas }}
      contentContainerStyle={{
        paddingTop: t.space.md,
        paddingBottom: insets.bottom + t.space.huge,
        paddingHorizontal: t.space.screenGutter,
        gap: t.space.xxl,
      }}
    >
      <View style={{ gap: t.space.sm }}>
        {recipe.category ? (
          <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>{recipe.category}</Text>
        ) : null}
        <Text accessibilityRole="header" maxFontSizeMultiplier={maxScale("recipeTitle")} style={[textStyle("recipeTitle"), { color: c.text }]}>
          {recipe.title}
        </Text>
        {meta ? <Text style={[textStyle("subhead"), { color: c.textSecondary }]}>{meta}</Text> : null}
        {recipe.description ? (
          <Text style={[textStyle("body"), { color: c.textSecondary, marginTop: t.space.xs }]}>
            {recipe.description}
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={() => navigation.navigate("CookMode", { recipeId: recipe.id })}
        accessibilityRole="button"
        accessibilityLabel="Start Cook Mode"
        style={({ pressed }) => [
          styles.cta,
          { backgroundColor: c.accent, borderRadius: t.radius.md, opacity: pressed ? 0.85 : 1, minHeight: t.minTouch },
        ]}
      >
        <Text style={[textStyle("headline"), { color: c.onAccent }]}>Start Cook Mode</Text>
      </Pressable>

      {recipe.sections.map((section, si) => (
        <View key={`ing-${si}`} style={{ gap: t.space.md }}>
          <Text maxFontSizeMultiplier={maxScale("sectionTitle")} style={[textStyle("sectionTitle"), { color: c.text }]}>
            {section.name ? `${section.name} — ingredients` : "Ingredients"}
          </Text>
          <View style={[styles.card, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
            {section.ingredients.map((ing, i) => (
              <View
                key={ing.id}
                style={[
                  styles.ingredientRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator },
                ]}
              >
                <Text style={[textStyle("body"), { color: c.text, flex: 1, minWidth: 0 }]}>
                  {ing.name}
                  {ing.optional ? (
                    <Text style={{ color: c.textTertiary }}>  optional</Text>
                  ) : null}
                </Text>
                <Text
                  style={[
                    textStyle("body"),
                    { color: c.textSecondary, fontVariant: ["tabular-nums"], textAlign: "right" },
                  ]}
                >
                  {formatQuantity(ing)}
                  {ing.weightAmount ? ` (${ing.weightAmount}${ing.weightUnit ?? ""})` : ""}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      {recipe.sections.map((section, si) => (
        <View key={`steps-${si}`} style={{ gap: t.space.md }}>
          <Text maxFontSizeMultiplier={maxScale("sectionTitle")} style={[textStyle("sectionTitle"), { color: c.text }]}>
            {section.name ? `${section.name} — method` : "Method"}
          </Text>
          {section.steps.map((step, i) => {
            const used = stepIngredientUses(recipe, step);
            return (
              <View key={step.id} style={{ gap: t.space.sm, paddingBottom: t.space.md }}>
                <View style={styles.stepHead}>
                  <Text style={[textStyle("eyebrow"), { color: c.textTertiary, width: 28 }]}>
                    {String(i + 1).padStart(2, "0")}
                  </Text>
                  <Text style={[textStyle("body"), { color: c.text, flex: 1, minWidth: 0 }]}>
                    {step.text}
                  </Text>
                </View>
                {used.length > 0 ? (
                  // Marginalia: what this step uses, resolved from the list.
                  <View style={styles.refs}>
                    {used.map((use) => (
                      <View
                        key={use.ingredient.id}
                        style={[
                          styles.refChip,
                          {
                            // A total reads as context, not as an instruction,
                            // so it is held back from the accent treatment.
                            backgroundColor: use.isTotal ? c.sunken : c.accentSoft,
                            borderRadius: 999,
                          },
                        ]}
                      >
                        <Text
                          style={[textStyle("footnote"), { color: use.isTotal ? c.textSecondary : c.accentText }]}
                          numberOfLines={1}
                        >
                          {useChipLabel(use)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}

      {recipe.notes ? (
        <View style={{ gap: t.space.sm }}>
          <Text maxFontSizeMultiplier={maxScale("sectionTitle")} style={[textStyle("sectionTitle"), { color: c.text }]}>Notes</Text>
          <Text style={[textStyle("body"), { color: c.textSecondary }]}>{recipe.notes}</Text>
        </View>
      ) : null}

      {recipe.source ? (
        <View style={{ gap: t.space.sm }}>
          <Text maxFontSizeMultiplier={maxScale("sectionTitle")} style={[textStyle("sectionTitle"), { color: c.text }]}>Source</Text>
          <View style={[styles.card, { backgroundColor: c.surface, borderRadius: t.radius.md, padding: t.space.lg, gap: 4 }]}>
            <Text style={[textStyle("body"), { color: c.text }]}>{sourceLine(recipe.source)}</Text>
            {recipe.source.originalTitle && recipe.source.originalTitle !== recipe.title ? (
              <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>
                Published as “{recipe.source.originalTitle}”
              </Text>
            ) : null}
            {recipe.source.url ? (
              <Text style={[textStyle("footnote"), { color: c.textTertiary }]} numberOfLines={1}>
                {recipe.source.url}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { overflow: "hidden" },
  ingredientRow: { flexDirection: "row", gap: 16, alignItems: "baseline", paddingVertical: 11, paddingHorizontal: 16 },
  cta: { alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  stepHead: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  refs: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 38 },
  refChip: { paddingHorizontal: 10, paddingVertical: 4, maxWidth: "100%" },
});
