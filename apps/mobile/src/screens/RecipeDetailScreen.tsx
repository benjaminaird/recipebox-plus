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
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme/ThemeProvider";
import { maxScale, textStyle } from "../theme/fonts";
import { DEFAULT_VIEW, getRecipe, getRecipeView, saveRecipeView, type RecipeView } from "../data/db";
import { useSettings } from "../settings/SettingsProvider";
import { openingView } from "../data/query";
import { OrganiseSheet } from "../components/OrganiseSheet";
import { AddToListSheet } from "../components/AddToListSheet";
import { displayTag } from "../domain/tags";
import { collectCategories, collectTags } from "../data/types";
import { listRecipes, saveRecipe } from "../data/db";
import { stepIngredientUses, type Recipe, type Source } from "../data/types";
import { ServingControls } from "../components/ServingControls";
import { detectSystem, measuresAgree, presentAmount, scaleLabel } from "../domain/present";
import { batchAdvisories } from "../domain/timing";
import { durationsInText } from "../domain/timer";
import { TimerButton } from "../timers/TimerButton";
import { TimerSheet } from "../timers/TimerSheet";
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

  // The Settings default applies to a recipe with no saved view of its own.
  const { measurement: preferred } = useSettings();
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [view, setView] = useState<RecipeView>(DEFAULT_VIEW);
  const [timersOpen, setTimersOpen] = useState(false);
  const [organiseOpen, setOrganiseOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // The library's own vocabulary, so the common case is tapping a name that
  // already exists rather than retyping it slightly differently.
  const [library, setLibrary] = useState<Recipe[]>([]);

  // On focus, not on mount. The editor is a modal over this screen, so
  // returning from it does not remount: loading once meant a saved edit was
  // invisible here until the recipe was closed and reopened, which reads as
  // the edit having silently failed.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      listRecipes().then((all) => { if (live) setLibrary(all); }).catch(() => {});
      Promise.all([getRecipe(params.recipeId), getRecipeView(params.recipeId)])
        .then(([r, saved]) => {
          if (!live) return;
          setRecipe(r);
          // A saved view wins. Otherwise open on the Settings default, but
          // only where this recipe can actually offer it.
          setView(saved ?? openingView(r, preferred));
        })
        .catch(() => { if (live) setRecipe(null); });
      return () => { live = false; };
    }, [params.recipeId, preferred]),
  );

  // Persisted, so Cook Mode opens on the batch the cook actually chose --
  // including after a restart, when resuming at 1x would hand them the wrong
  // quantities for a dish already in the oven.
  const update = useCallback((next: RecipeView) => {
    setView(next);
    saveRecipeView(params.recipeId, next).catch(() => {});
  }, [params.recipeId]);

  const originalSystem = useMemo(
    () => detectSystem((recipe?.sections ?? []).flatMap((s) => s.ingredients.map((i) => i.unit))),
    [recipe],
  );
  const advisories = useMemo(
    () => batchAdvisories(
      (recipe?.sections ?? []).flatMap((s) => s.steps.map((st) => st.text)),
      view.scale,
    ),
    [recipe, view.scale],
  );

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

        {/* Tags, and the way in to changing any of this. Shown as the plain
            truth about the recipe rather than as controls: tapping one does
            not filter from here, because the cook came to this screen to
            cook, not to browse. */}
        <Pressable
          onPress={() => setOrganiseOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            (recipe.tags ?? []).length > 0
              ? `Category and tags: ${[recipe.category, ...(recipe.tags ?? [])].filter(Boolean).join(", ")}. Edit`
              : "Add a category or tags"
          }
          style={({ pressed }) => [styles.organise, { marginTop: t.space.xs, opacity: pressed ? 0.6 : 1 }]}
        >
          {(recipe.tags ?? []).map((tag) => (
            <View
              key={tag}
              style={[styles.tag, { backgroundColor: c.sunken, borderRadius: t.radius.pill }]}
            >
              <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>{displayTag(tag)}</Text>
            </View>
          ))}
          <View style={[styles.tag, { borderRadius: t.radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: c.separatorStrong }]}>
            <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>
              {/* Not "Edit": the header button is Edit, and two controls with
                  one word between them is a guess the cook has to make. */}
              {(recipe.tags ?? []).length > 0 || recipe.category ? "Tags & category" : "Add a category or tags"}
            </Text>
          </View>
        </Pressable>
      </View>

      <ServingControls
        scale={view.scale}
        measurement={view.measurement}
        originalSystem={originalSystem}
        servings={recipe.servings}
        onChangeScale={(scale) => update({ ...view, scale })}
        onChangeMeasurement={(measurement) => update({ ...view, measurement })}
      />

      {/* Side by side the button takes whatever width the timer chip leaves
          it, which at accessibility text sizes is three words stacked inside a
          tall green block. Above the threshold they go one above the other and
          each gets the full width. */}
      <View style={[styles.ctaRow, t.largeText && styles.ctaRowStacked]}>
        <View style={t.largeText ? { alignSelf: "stretch" } : { flex: 1 }}>
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
        </View>
        <TimerButton onPress={() => setTimersOpen(true)} />
      </View>

      {/* Shopping, from here, at the batch currently on screen. A cook looking
          at a doubled recipe wants a doubled list, and asking them to set the
          batch again somewhere else would be asking twice. */}
      <Pressable
        onPress={() => setListOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={
          view.scale === 1
            ? "Add these ingredients to a shopping list"
            : `Add these ingredients to a shopping list, at ${scaleLabel(view.scale)}`
        }
        style={({ pressed }) => [
          styles.listCta,
          { borderColor: c.separatorStrong, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Ionicons name="cart-outline" size={18} color={c.accentText} />
        <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>
          {view.scale === 1 ? "Add to a shopping list" : `Add to a shopping list (${scaleLabel(view.scale)})`}
        </Text>
      </Pressable>

      {advisories.length > 0 ? (
        <View style={{ gap: t.space.sm }}>
          {advisories.map((a) => (
            <View
              key={a.title}
              style={[styles.advisory, { backgroundColor: c.attentionSoft, borderRadius: t.radius.md }]}
            >
              <Text style={[textStyle("footnote"), { color: c.attention, fontWeight: "600" }]}>
                {a.title}
              </Text>
              <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>{a.detail}</Text>
            </View>
          ))}
        </View>
      ) : null}


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
                {(() => {
                  const shown = presentAmount(ing.amount, ing.unit, ing.name, view);
                  return (
                    <View style={{ alignItems: "flex-end", flexShrink: 0 }}>
                      <Text
                        style={[
                          textStyle("body"),
                          {
                            color: shown.converted ? c.accentText : c.textSecondary,
                            fontVariant: ["tabular-nums"],
                            textAlign: "right",
                          },
                        ]}
                      >
                        {shown.text}
                      </Text>
                      {/* The gram weight a source sometimes gives alongside a
                          cup measure. It goes through presentAmount like
                          everything else, because printing the recipe's raw
                          175 g beside a doubled 350 g is worse than printing
                          nothing -- and it is suppressed when it only repeats
                          the line above. */}
                      {(() => {
                        if (view.measurement !== "original" || !ing.weightAmount) return null;
                        const hint = presentAmount(ing.weightAmount, ing.weightUnit, ing.name, {
                          scale: view.scale,
                          measurement: "original",
                        });
                        if (!hint.text || measuresAgree(hint.text, shown.text)) return null;
                        return (
                          <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
                            {hint.text}
                          </Text>
                        );
                      })()}
                    </View>
                  );
                })()}
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
                          {(() => {
                            const shown = presentAmount(use.amount, use.unit, use.ingredient.name, view);
                            // A share given as words ("the rest") has no
                            // amount to scale, so its own text stands.
                            const amount = use.amount ? shown.text : use.quantity;
                            if (!amount) return use.ingredient.name;
                            return use.isTotal
                              ? `${use.ingredient.name} · ${amount} total`
                              : `${amount} ${use.ingredient.name}`;
                          })()}
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

      <TimerSheet
        visible={timersOpen}
        onClose={() => setTimersOpen(false)}
        recipeId={recipe.id}
        suggestions={Array.from(
          new Set(recipe.sections.flatMap((sec) => sec.steps.flatMap((st) => durationsInText(st.text)))),
        ).sort((a, b) => a - b)}
        defaultLabel={recipe.title}
      />

      <AddToListSheet
        visible={listOpen}
        onClose={() => setListOpen(false)}
        sources={[{ recipeId: recipe.id, title: recipe.title, scale: view.scale }]}
        summary={`${recipe.title}${view.scale === 1 ? "" : ` at ${scaleLabel(view.scale)}`}`}
        onDone={(listId) => navigation.navigate("ShoppingList", { listId })}
      />

      <OrganiseSheet
        visible={organiseOpen}
        onClose={() => setOrganiseOpen(false)}
        title={recipe.title}
        category={recipe.category}
        tags={recipe.tags}
        allCategories={collectCategories(library)}
        allTags={collectTags(library)}
        onSave={(next) => {
          // Write the whole recipe back: category and tags live on the record
          // itself and in the search index, and saveRecipe rebuilds both.
          const updated = {
            ...recipe,
            category: next.category,
            tags: next.tags,
            updatedAt: Date.now(),
          };
          setRecipe(updated);
          saveRecipe(updated)
            .then(() => listRecipes())
            .then(setLibrary)
            .catch(() => {});
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { overflow: "hidden" },
  organise: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  tag: { paddingHorizontal: 11, paddingVertical: 5 },
  ingredientRow: { flexDirection: "row", gap: 16, alignItems: "baseline", paddingVertical: 11, paddingHorizontal: 16 },
  cta: { alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  stepHead: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  refs: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 38 },
  refChip: { paddingHorizontal: 10, paddingVertical: 4, maxWidth: "100%" },
  advisory: { padding: 12, gap: 4 },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  ctaRowStacked: { flexDirection: "column", alignItems: "stretch", gap: 12 },
  listCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
});
