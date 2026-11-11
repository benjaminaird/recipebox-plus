// The meal planner.
//
// ## Why a day at a time, and not a grid
//
// Seven days times four slots is twenty-eight cells. On a phone that is either
// unreadably small or a horizontal scroll in both axes, and it is unusable with
// one hand. So navigation is a week strip the thumb can reach, and the body is
// one day in full: the slots in the order they are eaten, each with what is
// planned and a way to add.
//
// The strip still shows the week at a glance -- a dot marks any day with
// something planned -- so the overview a grid would have given is kept without
// the grid.
//
// ## What is deliberately absent
//
// No drag and drop. Moving a meal is a sheet with "Move to" in it, which works
// one-handed, works with VoiceOver, and does not need a gesture that competes
// with the week strip's horizontal scroll.
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeProvider";
import { maxScale, textStyle } from "../theme/fonts";
import { RecipePicker } from "../components/RecipePicker";
import { AddToListSheet } from "../components/AddToListSheet";
import {
  deletePlannedMeal, listPlannedMeals, listRecipes, savePlannedMeal,
} from "../data/db";
import type { Recipe } from "../data/types";
import {
  MEAL_SLOTS, PLAN_SCALES, SLOT_LABELS, addDays, dayLabel, dayOfMonth, mealCounts,
  mealsBySlot, mealsInRange, monthLabel, nextPosition, toDateKey, weekOf, weekdayInitial,
  type DateKey, type MealSlot, type PlannedMeal,
} from "../domain/plan";
import { scaleLabel } from "../domain/present";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function newId(): string {
  return `pm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function PlanScreen() {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const today = useMemo(() => toDateKey(new Date()), []);
  const [selected, setSelected] = useState<DateKey>(today);
  const [meals, setMeals] = useState<PlannedMeal[] | null>(null);
  const [recipes, setRecipes] = useState<Map<string, Recipe>>(new Map());
  const [picking, setPicking] = useState<MealSlot | null>(null);
  const [editing, setEditing] = useState<PlannedMeal | null>(null);
  const [shopping, setShopping] = useState<"day" | "week" | null>(null);

  const load = useCallback(() => {
    let live = true;
    Promise.all([listPlannedMeals(), listRecipes()])
      .then(([planned, all]) => {
        if (!live) return;
        setMeals(planned);
        setRecipes(new Map(all.map((r) => [r.id, r])));
      })
      .catch(() => { if (live) setMeals([]); });
    return () => { live = false; };
  }, []);

  useFocusEffect(load);

  const week = useMemo(() => weekOf(selected), [selected]);
  const counts = useMemo(() => mealCounts(meals ?? []), [meals]);
  const bySlot = useMemo(() => mealsBySlot(meals ?? [], selected), [meals, selected]);
  const dayTotal = MEAL_SLOTS.reduce((n, s) => n + bySlot[s].length, 0);

  const write = useCallback(async (next: PlannedMeal) => {
    setMeals((prev) => {
      const rest = (prev ?? []).filter((m) => m.id !== next.id);
      return [...rest, next];
    });
    await savePlannedMeal(next).catch(() => {});
  }, []);

  const remove = useCallback(async (id: string) => {
    setMeals((prev) => (prev ?? []).filter((m) => m.id !== id));
    await deletePlannedMeal(id).catch(() => {});
  }, []);

  const add = useCallback(async (slot: MealSlot, recipe: Recipe) => {
    const now = Date.now();
    await write({
      id: newId(),
      date: selected,
      slot,
      recipeId: recipe.id,
      // 1x, always. A batch is a decision about one cooking, and silently
      // planning someone at 3x because they once tripled something is worse
      // than making them say so.
      scale: 1,
      position: nextPosition(meals ?? [], selected, slot),
      createdAt: now,
      updatedAt: now,
    });
  }, [selected, meals, write]);

  // What a "shop this" button would put on a list: every planned meal in the
  // range, each at the batch it is planned at. A recipe planned twice appears
  // twice, so the scales add and two dinners buy two dinners' worth.
  const shoppingSources = useMemo(() => {
    if (!shopping || !meals) return [];
    const range = shopping === "day"
      ? mealsInRange(meals, selected, selected)
      : mealsInRange(meals, week[0], week[6]);
    return range.flatMap((m) => {
      const recipe = recipes.get(m.recipeId);
      return recipe ? [{ recipeId: recipe.id, title: recipe.title, scale: m.scale }] : [];
    });
  }, [shopping, meals, selected, week, recipes]);

  const weekCount = useMemo(
    () => (meals ? mealsInRange(meals, week[0], week[6]).length : 0),
    [meals, week],
  );

  if (!meals) {
    return (
      <View style={[styles.centre, { backgroundColor: c.canvas }]}>
        <ActivityIndicator color={c.textTertiary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + t.space.lg,
          paddingBottom: insets.bottom + t.space.huge,
          gap: t.space.lg,
        }}
      >
        <View style={{ paddingHorizontal: t.space.screenGutter, gap: t.space.xs }}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={maxScale("largeTitle")}
            style={[textStyle("largeTitle"), { color: c.text }]}
          >
            Plan
          </Text>
          <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
            {monthLabel(week[0], week[6])}
          </Text>
        </View>

        {/* The week strip. Horizontal, thumb-high, and the only navigation the
            screen needs: tap a day, or swipe the strip to reach the next week. */}
        <View style={{ gap: t.space.sm }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: t.space.screenGutter, gap: 8 }}
            accessibilityLabel="Choose a day"
          >
            <DayStep label="Previous week" icon="chevron-back" onPress={() => setSelected(addDays(selected, -7))} />
            {week.map((date) => {
              const isSelected = date === selected;
              const isToday = date === today;
              const planned = counts[date] ?? 0;
              return (
                <Pressable
                  key={date}
                  onPress={() => setSelected(date)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${dayLabel(date, today)}${planned ? `, ${planned} planned` : ", nothing planned"}`}
                  style={({ pressed }) => [
                    styles.day,
                    {
                      backgroundColor: isSelected ? c.accent : c.surface,
                      borderRadius: t.radius.md,
                      borderWidth: isToday && !isSelected ? 1.5 : StyleSheet.hairlineWidth,
                      borderColor: isToday && !isSelected ? c.accentText : c.separator,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={[textStyle("footnote"), { color: isSelected ? c.onAccent : c.textTertiary }]}
                  >
                    {weekdayInitial(date)}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={[textStyle("cardTitle"), { color: isSelected ? c.onAccent : c.text }]}
                  >
                    {dayOfMonth(date)}
                  </Text>
                  {/* A dot, not a number: the count is in the label for
                      VoiceOver, and on screen "something is planned" is the
                      only thing that changes a decision. */}
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: planned ? (isSelected ? c.onAccent : c.accentText) : "transparent" },
                    ]}
                  />
                </Pressable>
              );
            })}
            <DayStep label="Next week" icon="chevron-forward" onPress={() => setSelected(addDays(selected, 7))} />
          </ScrollView>
        </View>

        <View style={{ paddingHorizontal: t.space.screenGutter, gap: t.space.md }}>
          <View style={styles.dayHead}>
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={maxScale("sectionTitle")}
              style={[textStyle("sectionTitle"), { color: c.text, flex: 1 }]}
            >
              {dayLabel(selected, today)}
            </Text>
            {selected !== today ? (
              <Pressable
                onPress={() => setSelected(today)}
                accessibilityRole="button"
                accessibilityLabel="Jump to today"
                hitSlop={10}
                style={{ minHeight: t.minTouch, justifyContent: "center" }}
              >
                <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>Today</Text>
              </Pressable>
            ) : null}
          </View>

          {dayTotal === 0 ? (
            <Text style={[textStyle("body"), { color: c.textSecondary }]}>
              Nothing planned for this day. Add a meal below, and it will be here when you come
              back — and ready to turn into a shopping list.
            </Text>
          ) : null}

          {dayTotal > 0 || weekCount > 0 ? (
            <View style={styles.shopRow}>
              {dayTotal > 0 ? (
                <Pressable
                  onPress={() => setShopping("day")}
                  accessibilityRole="button"
                  accessibilityLabel={`Shop for ${dayLabel(selected, today).toLowerCase()}`}
                  style={({ pressed }) => [
                    styles.shopBtn,
                    { backgroundColor: c.accentSoft, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Ionicons name="cart-outline" size={16} color={c.accentText} />
                  <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>
                    Shop this day
                  </Text>
                </Pressable>
              ) : null}
              {weekCount > 0 ? (
                <Pressable
                  onPress={() => setShopping("week")}
                  accessibilityRole="button"
                  accessibilityLabel={`Shop for the whole week, ${weekCount} meals`}
                  style={({ pressed }) => [
                    styles.shopBtn,
                    { backgroundColor: c.accentSoft, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Ionicons name="cart-outline" size={16} color={c.accentText} />
                  <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>
                    Shop this week ({weekCount})
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {MEAL_SLOTS.map((slot) => (
            <View key={slot} style={{ gap: t.space.sm }}>
              <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]} maxFontSizeMultiplier={1.4}>
                {SLOT_LABELS[slot]}
              </Text>

              {bySlot[slot].map((m) => {
                const recipe = recipes.get(m.recipeId);
                return (
                  <View
                    key={m.id}
                    style={[styles.meal, { backgroundColor: c.surface, borderRadius: t.radius.md }]}
                  >
                    <Pressable
                      onPress={() => recipe && navigation.navigate("RecipeDetail", { recipeId: m.recipeId })}
                      disabled={!recipe}
                      accessibilityRole="button"
                      accessibilityLabel={
                        recipe
                          ? `${recipe.title}${m.scale !== 1 ? `, ${scaleLabel(m.scale as never)}` : ""}. Open recipe`
                          : "This recipe is no longer in your library"
                      }
                      style={({ pressed }) => [styles.mealMain, { opacity: pressed ? 0.6 : 1 }]}
                    >
                      <Text style={[textStyle("cardTitle"), { color: recipe ? c.text : c.textTertiary }]} numberOfLines={2}>
                        {/* A plan can outlive the recipe it points at. Saying so
                            is better than a row that opens nothing. */}
                        {recipe?.title ?? "Recipe no longer in your library"}
                      </Text>
                      {recipe && m.scale !== 1 ? (
                        <Text style={[textStyle("footnote"), { color: c.accentText }]}>
                          {scaleLabel(m.scale as never)} batch
                        </Text>
                      ) : null}
                    </Pressable>
                    <Pressable
                      onPress={() => setEditing(m)}
                      accessibilityRole="button"
                      accessibilityLabel={`Options for ${recipe?.title ?? "this meal"}`}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.mealMore,
                        { minHeight: t.minTouch, opacity: pressed ? 0.5 : 1 },
                      ]}
                    >
                      <Ionicons name="ellipsis-horizontal" size={20} color={c.textTertiary} />
                    </Pressable>
                  </View>
                );
              })}

              <Pressable
                onPress={() => setPicking(slot)}
                accessibilityRole="button"
                accessibilityLabel={`Add a recipe to ${SLOT_LABELS[slot].toLowerCase()}`}
                style={({ pressed }) => [
                  styles.add,
                  {
                    borderColor: c.separatorStrong,
                    borderRadius: t.radius.md,
                    minHeight: t.minTouch,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <Ionicons name="add" size={18} color={c.accentText} />
                <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>
                  Add
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>

      <RecipePicker
        visible={picking !== null}
        onClose={() => setPicking(null)}
        title={picking ? `Add to ${SLOT_LABELS[picking].toLowerCase()}` : "Add a meal"}
        subtitle={dayLabel(selected, today)}
        onPick={(recipe) => { if (picking) add(picking, recipe); }}
      />

      <AddToListSheet
        visible={shopping !== null}
        onClose={() => setShopping(null)}
        sources={shoppingSources}
        summary={
          shopping === "week"
            ? `${weekCount} meal${weekCount === 1 ? "" : "s"} from ${monthLabel(week[0], week[6])}`
            : `${dayTotal} meal${dayTotal === 1 ? "" : "s"} on ${dayLabel(selected, today).toLowerCase()}`
        }
        onDone={(listId) => navigation.navigate("ShoppingList", { listId })}
      />

      <MealOptions
        meal={editing}
        recipeTitle={editing ? recipes.get(editing.recipeId)?.title : undefined}
        today={today}
        onClose={() => setEditing(null)}
        // Stays open: a cook moving a meal often changes the batch too, and a
        // sheet that dismisses after every tap makes the second change a
        // second journey. Done closes it.
        onChange={(next) => { write(next); setEditing(next); }}
        onRemove={(id) => { remove(id); setEditing(null); }}
      />
    </View>
  );
}

function DayStep({ label, icon, onPress }: { label: string; icon: "chevron-back" | "chevron-forward"; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.day,
        {
          backgroundColor: "transparent",
          borderRadius: t.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.colors.separator,
          opacity: pressed ? 0.5 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={t.colors.textTertiary} />
    </Pressable>
  );
}

/** Move, rescale or remove one planned meal. A sheet rather than a gesture:
 *  it works one-handed and it works with VoiceOver. */
function MealOptions({
  meal, recipeTitle, today, onClose, onChange, onRemove,
}: {
  meal: PlannedMeal | null;
  recipeTitle?: string;
  today: DateKey;
  onClose: () => void;
  onChange: (next: PlannedMeal) => void;
  onRemove: (id: string) => void;
}) {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  if (!meal) return null;

  const touch = (next: Partial<PlannedMeal>) => onChange({ ...meal, ...next, updatedAt: Date.now() });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: t.space.lg }}>
        <View style={[styles.sheetBar, { paddingHorizontal: t.space.screenGutter }]}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.25}
            numberOfLines={1}
            style={[textStyle("sectionTitle"), { color: c.text, flex: 1 }]}
          >
            {recipeTitle ?? "Planned meal"}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Done" hitSlop={12}
            style={{ minHeight: t.minTouch, justifyContent: "center" }}>
            <Text style={[textStyle("headline"), { color: c.accentText }]}>Done</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: t.space.screenGutter,
            paddingBottom: insets.bottom + t.space.huge,
            gap: t.space.xxl,
          }}
        >
          <View style={{ gap: t.space.sm }}>
            <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>Meal</Text>
            <View style={styles.pillRow}>
              {MEAL_SLOTS.map((slot) => (
                <Pill
                  key={slot}
                  label={SLOT_LABELS[slot]}
                  selected={meal.slot === slot}
                  onPress={() => touch({ slot })}
                />
              ))}
            </View>
          </View>

          <View style={{ gap: t.space.sm }}>
            <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>Day</Text>
            <View style={styles.pillRow}>
              {[-1, 1, 7].map((delta) => (
                <Pill
                  key={delta}
                  label={delta === -1 ? "Day earlier" : delta === 1 ? "Day later" : "Week later"}
                  selected={false}
                  onPress={() => touch({ date: addDays(meal.date, delta) })}
                />
              ))}
            </View>
            <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
              Currently {dayLabel(meal.date, today)}.
            </Text>
          </View>

          <View style={{ gap: t.space.sm }}>
            <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>Batch</Text>
            <View style={styles.pillRow}>
              {PLAN_SCALES.map((s) => (
                <Pill
                  key={s}
                  label={scaleLabel(s as never)}
                  selected={meal.scale === s}
                  onPress={() => touch({ scale: s })}
                />
              ))}
            </View>
            <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
              The shopping list uses this, so a doubled meal buys doubled ingredients.
            </Text>
          </View>

          <Pressable
            onPress={() => onRemove(meal.id)}
            accessibilityRole="button"
            accessibilityLabel="Remove from the plan"
            style={({ pressed }) => [
              styles.remove,
              { borderColor: c.separatorStrong, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={[textStyle("headline"), { color: c.danger }]}>Remove from the plan</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const c = t.colors;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: selected ? c.accent : c.surface,
          borderColor: selected ? c.accent : c.separatorStrong,
          borderRadius: t.radius.pill,
          minHeight: t.minTouch,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text style={[textStyle("footnote"), { color: selected ? c.onAccent : c.text, fontWeight: "600" }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  day: { width: 48, paddingVertical: 10, alignItems: "center", justifyContent: "center", gap: 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 2 },
  dayHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  shopRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  shopBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14 },
  meal: { flexDirection: "row", alignItems: "center", overflow: "hidden" },
  mealMain: { flex: 1, minWidth: 0, paddingVertical: 12, paddingLeft: 14, gap: 2 },
  mealMore: { paddingHorizontal: 14, justifyContent: "center" },
  add: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed" },
  sheetBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 12 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  remove: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
});
