// Cook Mode: one step at a time, at arm's length.
//
// The instruction is set in `cookStep` — system sans, 25/35 — because this is
// read across a kitchen, not curled up with (ADR 0018, ADR 0019). Each step
// shows the ingredients it uses, resolved from the list at render time, so the
// quantity on a step can never drift from the quantity in the list (ADR 0012).
//
// Where an ingredient is divided across steps, "For this step" shows that
// step's share. This is the number someone weighs out mid-cook, so a total
// shown in its place would be acted on: an unapportioned amount is marked
// "total" and muted instead of standing as the step's quantity.
//
// Progress is written to SQLite on every step change, so putting the phone
// down, backgrounding the app or force-quitting all return to the same step.
//
// Not yet built, and documented as outstanding requirements: multiple timers
// and background notifications.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme/ThemeProvider";
import { maxScale, textStyle } from "../theme/fonts";
import { clearProgress, DEFAULT_VIEW, getProgress, getRecipe, getRecipeView, saveProgress, type RecipeView } from "../data/db";
import { flattenSteps, stepIngredientUses, type Recipe } from "../data/types";
import { presentAmount, scaleLabel } from "../domain/present";
import { durationsInText } from "../domain/timer";
import { TimerButton } from "../timers/TimerButton";
import { TimerSheet } from "../timers/TimerSheet";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "CookMode">;

export function CookModeScreen() {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();

  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [index, setIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);
  // Read, never chosen here: Cook Mode must show the batch the cook set on
  // the recipe, including after a restart mid-dish.
  const [view, setView] = useState<RecipeView>(DEFAULT_VIEW);
  const [timersOpen, setTimersOpen] = useState(false);

  // Load the recipe and the saved place together, so the first frame is
  // already on the right step rather than flashing step one.
  useEffect(() => {
    let live = true;
    Promise.all([
      getRecipe(params.recipeId),
      getProgress(params.recipeId),
      getRecipeView(params.recipeId),
    ])
      .then(([r, p, v]) => {
        if (!live) return;
        setRecipe(r);
        setView(v);
        if (r && p) {
          const total = flattenSteps(r).length;
          setIndex(Math.min(Math.max(p.stepIndex, 0), Math.max(total - 1, 0)));
        }
      })
      .catch(() => { if (live) setRecipe(null); });
    return () => { live = false; };
  }, [params.recipeId]);

  const steps = useMemo(() => (recipe ? flattenSteps(recipe) : []), [recipe]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), Math.max(steps.length - 1, 0));
      setIndex(clamped);
      // Fire and forget: a failed write costs the saved place, not the session.
      saveProgress(params.recipeId, clamped).catch(() => {});
    },
    [params.recipeId, steps.length],
  );

  const finish = useCallback(() => {
    clearProgress(params.recipeId).catch(() => {});
    navigation.goBack();
  }, [navigation, params.recipeId]);

  if (recipe === undefined) {
    return (
      <View style={[styles.centre, { backgroundColor: c.canvas }]}>
        <ActivityIndicator color={c.textTertiary} />
      </View>
    );
  }
  if (recipe === null || steps.length === 0) {
    return (
      <View style={[styles.centre, { backgroundColor: c.canvas, padding: t.space.xxl, gap: t.space.md }]}>
        <Text maxFontSizeMultiplier={maxScale("sectionTitle")} style={[textStyle("sectionTitle"), { color: c.text }]}>Nothing to cook</Text>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={[textStyle("headline"), { color: c.accentText }]}>Close</Text>
        </Pressable>
      </View>
    );
  }

  const step = steps[index];
  const used = stepIngredientUses(recipe, step);
  const isLast = index === steps.length - 1;
  const progress = (index + 1) / steps.length;

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: insets.top }}>
      <View style={[styles.bar, { paddingHorizontal: t.space.screenGutter }]}>
        <Text style={[textStyle("eyebrow"), { color: c.textTertiary, flex: 1 }]} numberOfLines={1}>
          {recipe.title}
        </Text>
        {view.scale !== 1 ? (
          // Stated, not implied: the quantities below are not the ones the
          // recipe was written with.
          <View style={[styles.batch, { backgroundColor: c.accentSoft, borderRadius: 999 }]}>
            <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>
              {scaleLabel(view.scale)}
            </Text>
          </View>
        ) : null}
        <TimerButton compact onPress={() => setTimersOpen(true)} />
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Close Cook Mode"
          hitSlop={12}
          style={{ minHeight: t.minTouch, justifyContent: "center", paddingLeft: 12 }}
        >
          <Text style={[textStyle("headline"), { color: c.accentText }]}>Close</Text>
        </Pressable>
      </View>

      <View style={[styles.track, { backgroundColor: c.sunken, marginHorizontal: t.space.screenGutter }]}>
        <View
          accessible
          accessibilityLabel={`Step ${index + 1} of ${steps.length}`}
          style={{ width: `${progress * 100}%`, height: "100%", backgroundColor: c.accentText, borderRadius: 999 }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: t.space.screenGutter,
          paddingTop: t.space.xl,
          paddingBottom: t.space.xxl,
          gap: t.space.xl,
        }}
      >
        <View style={{ gap: t.space.xs }}>
          <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>
            {step.sectionName ? `${step.sectionName} · ` : ""}Step {index + 1} of {steps.length}
          </Text>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={maxScale("cookStep")}
            style={[textStyle("cookStep"), { color: c.text }]}
          >
            {step.text}
          </Text>
        </View>

        {used.length > 0 ? (
          <View style={{ gap: t.space.sm }}>
            <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>For this step</Text>
            <View style={[styles.card, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
              {used.map((use, i) => (
                <View
                  key={use.ingredient.id}
                  style={[
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator },
                  ]}
                >
                  <Text style={[textStyle("body"), { color: c.text, flex: 1, minWidth: 0 }]}>
                    {use.ingredient.name}
                  </Text>
                  <Text
                    style={[
                      textStyle("body"),
                      {
                        color: use.isTotal ? c.textTertiary : c.accentText,
                        fontVariant: ["tabular-nums"],
                        fontWeight: use.isTotal ? "400" : "600",
                      },
                    ]}
                  >
                    {(() => {
                      const shown = use.amount
                        ? presentAmount(use.amount, use.unit, use.ingredient.name, view).text
                        : use.quantity;
                      if (!shown) return "";
                      return use.isTotal ? `${shown} total` : shown;
                    })()}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ gap: t.space.sm }}>
          <Pressable
            onPress={() => setShowAll((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showAll }}
            style={{ minHeight: t.minTouch, justifyContent: "center" }}
          >
            <Text style={[textStyle("headline"), { color: c.accentText }]}>
              {showAll ? "Hide all ingredients" : "All ingredients"}
            </Text>
          </Pressable>
          {showAll
            ? recipe.sections.map((section, si) => (
                <View key={si} style={{ gap: t.space.xs, marginBottom: t.space.sm }}>
                  {section.name ? (
                    <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>{section.name}</Text>
                  ) : null}
                  <View style={[styles.card, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
                    {section.ingredients.map((ing, i) => (
                      <View
                        key={ing.id}
                        style={[
                          styles.row,
                          i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator },
                        ]}
                      >
                        <Text style={[textStyle("body"), { color: c.text, flex: 1, minWidth: 0 }]}>{ing.name}</Text>
                        <Text style={[textStyle("body"), { color: c.textSecondary, fontVariant: ["tabular-nums"] }]}>
                          {presentAmount(ing.amount, ing.unit, ing.name, view).text}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))
            : null}
        </View>
      </ScrollView>

      {/* At the largest text sizes a side-by-side pair cannot hold its labels:
          "Back" broke across two lines inside its own rounded rect and "Next
          step" overflowed. Above the large-text threshold the pair stacks, so
          each button has the full width and the primary action stays first. */}
      <View
        style={[
          styles.footer,
          t.largeText && styles.footerStacked,
          {
            paddingHorizontal: t.space.screenGutter,
            paddingBottom: insets.bottom + t.space.md,
            borderTopColor: c.separator,
            backgroundColor: c.canvas,
          },
        ]}
      >
        <Pressable
          onPress={() => goTo(index - 1)}
          disabled={index === 0}
          accessibilityRole="button"
          accessibilityLabel="Previous step"
          accessibilityState={{ disabled: index === 0 }}
          style={({ pressed }) => [
            styles.secondary,
            t.largeText && styles.fullWidth,
            {
              borderColor: c.separatorStrong,
              borderRadius: t.radius.md,
              minHeight: t.minTouch,
              paddingVertical: 12,
              opacity: index === 0 ? 0.35 : pressed ? 0.6 : 1,
            },
          ]}
        >
          <Text numberOfLines={1} style={[textStyle("headline"), { color: c.text }]}>Back</Text>
        </Pressable>

        <Pressable
          onPress={() => (isLast ? finish() : goTo(index + 1))}
          accessibilityRole="button"
          accessibilityLabel={isLast ? "Finish cooking" : "Next step"}
          style={({ pressed }) => [
            styles.primary,
            t.largeText && styles.fullWidth,
            {
              backgroundColor: c.accent,
              borderRadius: t.radius.md,
              minHeight: t.minTouch,
              paddingVertical: 12,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text numberOfLines={1} style={[textStyle("headline"), { color: c.onAccent }]}>
            {isLast ? "Finish" : "Next step"}
          </Text>
        </Pressable>
      </View>

      <TimerSheet
        visible={timersOpen}
        onClose={() => setTimersOpen(false)}
        recipeId={recipe.id}
        // Offered first: the durations this step actually names.
        suggestions={durationsInText(step.text)}
        suggestionsFrom="this step"
        defaultLabel={`${recipe.title} · Step ${index + 1}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  bar: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  track: { height: 4, borderRadius: 999, overflow: "hidden" },
  batch: { paddingHorizontal: 9, paddingVertical: 2, marginRight: 8 },
  card: { overflow: "hidden" },
  row: { flexDirection: "row", gap: 16, alignItems: "baseline", paddingVertical: 11, paddingHorizontal: 16 },
  footer: { flexDirection: "row", gap: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  // Stacked, primary first: the common action should not move to the bottom
  // of the screen just because the text got bigger.
  footerStacked: { flexDirection: "column-reverse" },
  secondary: { flex: 1, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  primary: { flex: 2, alignItems: "center", justifyContent: "center" },
  fullWidth: { flex: 0, alignSelf: "stretch", width: "100%" },
});
