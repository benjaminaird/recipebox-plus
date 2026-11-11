// Writing a recipe, and editing one.
//
// One screen for both, because they are the same task: the difference between
// "new" and "edit" is whether the draft starts empty, and a second screen
// would be a second set of validation rules to keep in step.
//
// ## Why it is a long form and not a wizard
//
// A cook copying off a card has the whole recipe in front of them and wants to
// type it in the order it is written. A wizard would make them finish the
// ingredients before they could start the method, which is not how a card
// reads and not how anyone types one.
//
// ## Step ingredients
//
// A step can be told which ingredients it uses (ADR 0012), which is what makes
// Cook Mode able to print quantities beside an instruction. It is offered as a
// row of toggles under each step, and it is entirely optional: a recipe with
// no assignments still works everywhere, it just shows fewer quantities.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeProvider";
import { inputStyle, maxScale, textStyle } from "../theme/fonts";
import { getRecipe, saveRecipe } from "../data/db";
import {
  allocateIngredientId, allocateStepId, canSave, draftFromRecipe, emptyDraft,
  recipeFromDraft, removeIngredient, removeStep, validateDraft,
  type Draft, type DraftSection,
} from "../domain/recipeDraft";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "RecipeEditor">;

function newRecipeId(): string {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function Field({
  label, value, onChange, placeholder, multiline, keyboardType, autoCapitalize, hint, error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: "default" | "numeric" | "url";
  autoCapitalize?: "none" | "sentences" | "words";
  hint?: string;
  error?: string;
}) {
  const t = useTheme();
  const c = t.colors;
  return (
    <View style={{ gap: t.space.xs }}>
      <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
      <View
        style={[
          styles.field,
          {
            backgroundColor: c.surface,
            borderRadius: t.radius.sm,
            borderColor: error ? c.danger : c.separatorStrong,
            minHeight: multiline ? 92 : t.minTouch,
          },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={c.textTertiary}
          multiline={multiline}
          keyboardType={keyboardType === "url" ? "url" : keyboardType}
          autoCapitalize={autoCapitalize ?? (multiline ? "sentences" : "sentences")}
          autoCorrect
          accessibilityLabel={label}
          style={[
            inputStyle("body"),
            { color: c.text, flex: 1, textAlignVertical: multiline ? "top" : "center" },
          ]}
        />
      </View>
      {error ? (
        <Text style={[textStyle("footnote"), { color: c.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function RecipeEditorScreen() {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const editingId = params?.recipeId;

  const [draft, setDraft] = useState<Draft | null>(editingId ? null : emptyDraft(newRecipeId()));
  const [saving, setSaving] = useState(false);
  const [showProblems, setShowProblems] = useState(false);

  useEffect(() => {
    if (!editingId) return;
    let live = true;
    getRecipe(editingId)
      .then((r) => {
        if (!live) return;
        // A recipe that has gone while the editor was opening is better said
        // than silently replaced with a blank one the cook would then save.
        if (!r) {
          Alert.alert("That recipe is gone", "It may have been deleted.", [
            { text: "Back", onPress: () => navigation.goBack() },
          ]);
          return;
        }
        setDraft(draftFromRecipe(r));
      })
      .catch(() => { if (live) setDraft(emptyDraft(newRecipeId())); });
    return () => { live = false; };
  }, [editingId, navigation]);

  const problems = useMemo(() => (draft ? validateDraft(draft) : []), [draft]);
  const blocking = problems.filter((p) => p.blocking);

  const patchSection = useCallback((index: number, patch: Partial<DraftSection>) => {
    setDraft((d) =>
      d ? { ...d, sections: d.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)) } : d,
    );
  }, []);

  const addIngredient = useCallback((sectionIndex: number) => {
    setDraft((d) => {
      if (!d) return d;
      const { id, draft: next } = allocateIngredientId(d);
      return {
        ...next,
        sections: next.sections.map((s, i) =>
          i === sectionIndex ? { ...s, ingredients: [...s.ingredients, { id, name: "", amount: "", unit: "" }] } : s,
        ),
      };
    });
  }, []);

  const addStep = useCallback((sectionIndex: number) => {
    setDraft((d) => {
      if (!d) return d;
      const { id, draft: next } = allocateStepId(d);
      return {
        ...next,
        sections: next.sections.map((s, i) =>
          i === sectionIndex ? { ...s, steps: [...s.steps, { id, text: "", ingredientRefs: [] }] } : s,
        ),
      };
    });
  }, []);

  const toggleRef = useCallback((sectionIndex: number, stepId: string, ingredientId: string) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            sections: d.sections.map((s, i) =>
              i !== sectionIndex
                ? s
                : {
                    ...s,
                    steps: s.steps.map((st) => {
                      if (st.id !== stepId) return st;
                      const refs = st.ingredientRefs ?? [];
                      return {
                        ...st,
                        ingredientRefs: refs.includes(ingredientId)
                          ? refs.filter((r) => r !== ingredientId)
                          : [...refs, ingredientId],
                      };
                    }),
                  },
            ),
          }
        : d,
    );
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    if (!canSave(draft)) {
      setShowProblems(true);
      return;
    }
    setSaving(true);
    try {
      const recipe = recipeFromDraft(draft);
      await saveRecipe(recipe);
      // Only leave once it is actually stored. A failed write that closed the
      // screen anyway would lose everything typed, with a success animation.
      navigation.goBack();
    } catch {
      setSaving(false);
      Alert.alert(
        "Could not save",
        "Nothing has been lost — your recipe is still here. Try again in a moment.",
      );
    }
  }, [draft, navigation]);

  if (!draft) {
    return <View style={[styles.centre, { backgroundColor: c.canvas }]}><ActivityIndicator color={c.textTertiary} /></View>;
  }

  const titleError = showProblems ? blocking.find((p) => p.field === "title")?.message : undefined;
  const urlError = showProblems ? blocking.find((p) => p.field === "sourceUrl")?.message : undefined;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.canvas }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: t.space.sm,
          paddingBottom: insets.bottom + t.space.huge * 2,
          paddingHorizontal: t.space.screenGutter,
          gap: t.space.xxl,
        }}
      >
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={maxScale("largeTitle")}
          style={[textStyle("largeTitle"), { color: c.text }]}
        >
          {editingId ? "Edit recipe" : "New recipe"}
        </Text>

        <View style={{ gap: t.space.lg }}>
          <Field
            label="Name"
            value={draft.title}
            onChange={(title) => setDraft({ ...draft, title })}
            placeholder="What is it called?"
            autoCapitalize="words"
            error={titleError}
          />
          <Field
            label="Description"
            value={draft.description}
            onChange={(description) => setDraft({ ...draft, description })}
            placeholder="A line about it — optional"
            multiline
          />
          <View style={styles.pair}>
            <View style={{ flex: 1 }}>
              <Field
                label="Serves"
                value={draft.servings}
                onChange={(servings) => setDraft({ ...draft, servings })}
                placeholder="4"
                keyboardType="numeric"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Total time"
                value={draft.totalTime}
                onChange={(totalTime) => setDraft({ ...draft, totalTime })}
                placeholder="45 min"
              />
            </View>
          </View>
        </View>

        {draft.sections.map((section, sectionIndex) => (
          <View key={sectionIndex} style={{ gap: t.space.lg }}>
            {draft.sections.length > 1 ? (
              <Field
                label={`Part ${sectionIndex + 1}`}
                value={section.name}
                onChange={(name) => patchSection(sectionIndex, { name })}
                placeholder="Shortbread base"
                autoCapitalize="words"
              />
            ) : null}

            <View style={{ gap: t.space.sm }}>
              <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]} maxFontSizeMultiplier={1.4}>
                Ingredients
              </Text>
              {section.ingredients.map((ingredient, i) => (
                <View key={ingredient.id} style={styles.ingredientRow}>
                  <View style={[styles.field, styles.amount, { backgroundColor: c.surface, borderRadius: t.radius.sm, borderColor: c.separatorStrong, minHeight: t.minTouch }]}>
                    <TextInput
                      value={ingredient.amount ?? ""}
                      onChangeText={(amount) =>
                        patchSection(sectionIndex, {
                          ingredients: section.ingredients.map((x, j) => (j === i ? { ...x, amount } : x)),
                        })
                      }
                      placeholder="250"
                      placeholderTextColor={c.textTertiary}
                      accessibilityLabel={`Amount for ingredient ${i + 1}`}
                      style={[inputStyle("body"), { color: c.text, flex: 1 }]}
                    />
                  </View>
                  <View style={[styles.field, styles.unit, { backgroundColor: c.surface, borderRadius: t.radius.sm, borderColor: c.separatorStrong, minHeight: t.minTouch }]}>
                    <TextInput
                      value={ingredient.unit ?? ""}
                      onChangeText={(unit) =>
                        patchSection(sectionIndex, {
                          ingredients: section.ingredients.map((x, j) => (j === i ? { ...x, unit } : x)),
                        })
                      }
                      placeholder="g"
                      placeholderTextColor={c.textTertiary}
                      autoCapitalize="none"
                      accessibilityLabel={`Unit for ingredient ${i + 1}`}
                      style={[inputStyle("body"), { color: c.text, flex: 1 }]}
                    />
                  </View>
                  <View style={[styles.field, { flex: 1, backgroundColor: c.surface, borderRadius: t.radius.sm, borderColor: c.separatorStrong, minHeight: t.minTouch }]}>
                    <TextInput
                      value={ingredient.name}
                      onChangeText={(name) =>
                        patchSection(sectionIndex, {
                          ingredients: section.ingredients.map((x, j) => (j === i ? { ...x, name } : x)),
                        })
                      }
                      placeholder="plain flour"
                      placeholderTextColor={c.textTertiary}
                      accessibilityLabel={`Name for ingredient ${i + 1}`}
                      style={[inputStyle("body"), { color: c.text, flex: 1 }]}
                    />
                  </View>
                  <Pressable
                    onPress={() => setDraft(removeIngredient(draft, ingredient.id))}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ingredient ${i + 1}`}
                    hitSlop={8}
                    style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.5 : 1 })}
                  >
                    <Ionicons name="close-circle" size={22} color={c.textTertiary} />
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={() => addIngredient(sectionIndex)}
                accessibilityRole="button"
                accessibilityLabel="Add an ingredient"
                style={({ pressed }) => [styles.add, { borderColor: c.separatorStrong, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name="add" size={18} color={c.accentText} />
                <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>Ingredient</Text>
              </Pressable>
            </View>

            <View style={{ gap: t.space.sm }}>
              <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]} maxFontSizeMultiplier={1.4}>
                Method
              </Text>
              {section.steps.map((step, i) => {
                const refs = step.ingredientRefs ?? [];
                const named = section.ingredients.filter((x) => x.name.trim());
                return (
                  <View key={step.id} style={{ gap: t.space.xs }}>
                    <View style={styles.stepRow}>
                      <Text style={[textStyle("footnote"), { color: c.textTertiary, paddingTop: 14, width: 20 }]}>
                        {i + 1}
                      </Text>
                      <View style={[styles.field, { flex: 1, backgroundColor: c.surface, borderRadius: t.radius.sm, borderColor: c.separatorStrong, minHeight: 72 }]}>
                        <TextInput
                          value={step.text}
                          onChangeText={(text) =>
                            patchSection(sectionIndex, {
                              steps: section.steps.map((x, j) => (j === i ? { ...x, text } : x)),
                            })
                          }
                          placeholder="What happens at this step?"
                          placeholderTextColor={c.textTertiary}
                          multiline
                          accessibilityLabel={`Step ${i + 1}`}
                          style={[inputStyle("body"), { color: c.text, flex: 1, textAlignVertical: "top" }]}
                        />
                      </View>
                      <Pressable
                        onPress={() => setDraft(removeStep(draft, step.id))}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove step ${i + 1}`}
                        hitSlop={8}
                        style={({ pressed }) => ({ padding: 4, paddingTop: 14, opacity: pressed ? 0.5 : 1 })}
                      >
                        <Ionicons name="close-circle" size={22} color={c.textTertiary} />
                      </Pressable>
                    </View>

                    {/* Which ingredients this step uses. Optional: a recipe with
                        none of these set still works, it just shows fewer
                        quantities in Cook Mode. */}
                    {named.length > 0 ? (
                      <View style={styles.refRow}>
                        {named.map((ingredient) => {
                          const on = refs.includes(ingredient.id);
                          return (
                            <Pressable
                              key={ingredient.id}
                              onPress={() => toggleRef(sectionIndex, step.id, ingredient.id)}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: on }}
                              accessibilityLabel={`${ingredient.name} used in step ${i + 1}`}
                              style={({ pressed }) => [
                                styles.refChip,
                                {
                                  backgroundColor: on ? c.accentSoft : "transparent",
                                  borderColor: on ? c.accentText : c.separator,
                                  borderRadius: t.radius.pill,
                                  opacity: pressed ? 0.6 : 1,
                                },
                              ]}
                            >
                              <Text
                                numberOfLines={1}
                                style={[textStyle("footnote"), { color: on ? c.accentText : c.textTertiary }]}
                              >
                                {ingredient.name.trim()}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })}
              <Pressable
                onPress={() => addStep(sectionIndex)}
                accessibilityRole="button"
                accessibilityLabel="Add a step"
                style={({ pressed }) => [styles.add, { borderColor: c.separatorStrong, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name="add" size={18} color={c.accentText} />
                <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>Step</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <Pressable
          onPress={() =>
            setDraft({ ...draft, sections: [...draft.sections, { name: "", ingredients: [], steps: [] }] })
          }
          accessibilityRole="button"
          accessibilityLabel="Add another part, like a sauce or a topping"
          style={({ pressed }) => [styles.add, { borderColor: c.separatorStrong, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="layers-outline" size={18} color={c.accentText} />
          <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>
            Another part (a sauce, a topping)
          </Text>
        </Pressable>

        <View style={{ gap: t.space.lg }}>
          <Field
            label="Category"
            value={draft.category}
            onChange={(category) => setDraft({ ...draft, category })}
            placeholder="Entrées"
            autoCapitalize="words"
            hint="Where it lives in your library. One, or none."
          />
          <Field
            label="Tags"
            value={draft.tags.join(", ")}
            onChange={(v) => setDraft({ ...draft, tags: v.split(",").map((x) => x.trim()).filter(Boolean) })}
            placeholder="Vegetarian, Weeknight"
            autoCapitalize="words"
            hint="Separated by commas."
          />
          <Field
            label="Where it came from"
            value={draft.sourceReference}
            onChange={(sourceReference) => setDraft({ ...draft, sourceReference })}
            placeholder="Granny's card, or a book and page"
            hint="Optional, and kept with the recipe."
          />
          <Field
            label="Link"
            value={draft.sourceUrl}
            onChange={(sourceUrl) => setDraft({ ...draft, sourceUrl })}
            placeholder="https://"
            keyboardType="url"
            autoCapitalize="none"
            error={urlError}
          />
        </View>

        {showProblems && problems.length > 0 ? (
          <View style={{ gap: t.space.xs }}>
            {problems.map((p) => (
              <Text
                key={`${p.field}-${p.message}`}
                style={[textStyle("footnote"), { color: p.blocking ? c.danger : c.textTertiary }]}
              >
                {p.message}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.bar, { backgroundColor: c.surface, borderTopColor: c.separator, paddingBottom: insets.bottom + 10 }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Discard and go back"
          style={({ pressed }) => [styles.secondary, { borderColor: c.separatorStrong, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={save}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={editingId ? "Save changes" : "Save the recipe"}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: c.accent, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed || saving ? 0.75 : 1 },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={c.onAccent} />
          ) : (
            <Text style={[textStyle("headline"), { color: c.onAccent }]}>
              {editingId ? "Save changes" : "Save recipe"}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  field: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth },
  pair: { flexDirection: "row", gap: 12 },
  ingredientRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  amount: { width: 68 },
  unit: { width: 60 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  refRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 26 },
  refChip: { paddingHorizontal: 10, paddingVertical: 5, borderWidth: StyleSheet.hairlineWidth, maxWidth: "100%" },
  add: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed", paddingVertical: 10 },
  bar: { flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  secondary: { flex: 1, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  primary: { flex: 2, alignItems: "center", justifyContent: "center" },
});
