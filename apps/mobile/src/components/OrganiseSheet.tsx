// Where a recipe lives, and what is true about it.
//
// One sheet, deliberately, rather than a hierarchy of category screens: the
// brief asked for assigning and editing without "an unnecessarily complicated
// hierarchy", and the honest shape of this task is two short lists and a text
// field. A cook opening this wants to put one recipe somewhere and then leave.
//
// Categories and tags stay visibly different things. The category list is
// single-select and shows a check; the tags are a field of pills that are
// either on or off. Nothing in the layout invites the mistake of treating
// "Vegetarian" and "Weeknight Dinners" as alternatives.
//
// Existing names come first and are one tap. Typing is there for the first
// recipe of a new kind, not as the main route -- a library where every recipe
// has its own slightly different category name is a library with no categories.
import { useEffect, useMemo, useState } from "react";
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeProvider";
import { inputStyle, maxScale, textStyle } from "../theme/fonts";
import {
  MAX_TAGS, addTag, displayTag, hasTag, normalizeCategory, normalizeRecipeTags,
  normalizeTagKey, removeTag, sameCategory, toggleTag,
} from "../domain/tags";

function Pill({
  label, selected, onPress, accessibilityLabel, accessibilityRole = "button",
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "radio" | "checkbox";
}) {
  const t = useTheme();
  const c = t.colors;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={accessibilityLabel ?? label}
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
      <Text
        style={[textStyle("footnote"), { color: selected ? c.onAccent : c.text, fontWeight: "600" }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function OrganiseSheet({
  visible, onClose, title, category, tags, allCategories, allTags, onSave,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  category?: string;
  tags?: string[];
  /** Every category already in the library, so the common case is one tap. */
  allCategories: string[];
  allTags: string[];
  onSave: (next: { category?: string; tags: string[] }) => void;
}) {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();

  const [draftCategory, setDraftCategory] = useState<string | undefined>(category);
  const [draftTags, setDraftTags] = useState<string[]>(() => normalizeRecipeTags(tags));
  const [newCategory, setNewCategory] = useState("");
  const [newTag, setNewTag] = useState("");

  // Reset whenever the sheet opens. Without this, closing without saving and
  // reopening would show the abandoned draft as though it had been kept.
  useEffect(() => {
    if (!visible) return;
    setDraftCategory(category);
    setDraftTags(normalizeRecipeTags(tags));
    setNewCategory("");
    setNewTag("");
  }, [visible, category, tags]);

  // The library's categories, plus this recipe's own if it is not in the list
  // yet (it may be the only recipe that has it).
  const categoryChoices = useMemo(() => {
    const out = [...allCategories];
    if (draftCategory && !out.some((x) => sameCategory(x, draftCategory))) out.unshift(draftCategory);
    return out;
  }, [allCategories, draftCategory]);

  const tagChoices = useMemo(() => {
    const out = [...allTags];
    for (const tag of draftTags) if (!out.some((x) => normalizeTagKey(x) === normalizeTagKey(tag))) out.push(tag);
    return out;
  }, [allTags, draftTags]);

  const atCap = draftTags.length >= MAX_TAGS;

  const commitNewCategory = () => {
    const next = normalizeCategory(newCategory);
    if (!next) return;
    setDraftCategory(next);
    setNewCategory("");
  };

  const commitNewTag = () => {
    const next = addTag(draftTags, newTag);
    // addTag is a no-op for a duplicate or at the cap, so compare rather than
    // assume: clearing the field on a rejected tag would look like it worked.
    if (next.length !== draftTags.length) setDraftTags(next);
    if (displayTag(newTag) && (next.length !== draftTags.length || hasTag(draftTags, newTag))) {
      setNewTag("");
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: t.space.lg }}>
        <View style={[styles.bar, { paddingHorizontal: t.space.screenGutter }]}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={12}
            style={{ minHeight: t.minTouch, justifyContent: "center" }}
          >
            <Text style={[textStyle("body"), { color: c.textSecondary }]}>Cancel</Text>
          </Pressable>
          <Text
            accessibilityRole="header"
            // Capped harder than the usual section title: it shares a row
            // with Cancel and Save, both of which grow, and at accessibility
            // sizes "Organise" became "Orga…". The sheet's own content says
            // what it is; the title is a label, so it gives way first.
            maxFontSizeMultiplier={1.25}
            numberOfLines={1}
            style={[textStyle("sectionTitle"), { color: c.text, flex: 1, textAlign: "center" }]}
          >
            Organise
          </Text>
          <Pressable
            onPress={() => {
              onSave({ category: draftCategory, tags: normalizeRecipeTags(draftTags) });
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="Save"
            hitSlop={12}
            style={{ minHeight: t.minTouch, justifyContent: "center" }}
          >
            <Text style={[textStyle("headline"), { color: c.accentText }]}>Save</Text>
          </Pressable>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: t.space.screenGutter,
            paddingTop: t.space.lg,
            paddingBottom: insets.bottom + t.space.huge,
            gap: t.space.xxl,
          }}
        >
          <Text style={[textStyle("footnote"), { color: c.textTertiary }]} numberOfLines={2}>
            {title}
          </Text>

          <View style={{ gap: t.space.sm }}>
            <Text accessibilityRole="header" style={[textStyle("eyebrow"), { color: c.textTertiary }]}>
              Category
            </Text>
            <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>
              Where this recipe lives. One, or none.
            </Text>
            <View style={styles.field}>
              <Pill
                label="None"
                accessibilityRole="radio"
                selected={!draftCategory}
                onPress={() => setDraftCategory(undefined)}
              />
              {categoryChoices.map((name) => (
                <Pill
                  key={name}
                  label={name}
                  accessibilityRole="radio"
                  selected={sameCategory(name, draftCategory)}
                  onPress={() => setDraftCategory(sameCategory(name, draftCategory) ? undefined : name)}
                />
              ))}
            </View>
            <View style={[styles.entry, { borderColor: c.separatorStrong, borderRadius: t.radius.sm, backgroundColor: c.surface }]}>
              <TextInput
                value={newCategory}
                onChangeText={setNewCategory}
                onSubmitEditing={commitNewCategory}
                placeholder="New category"
                placeholderTextColor={c.textTertiary}
                returnKeyType="done"
                autoCapitalize="words"
                accessibilityLabel="New category name"
                style={[inputStyle("body"), { color: c.text, flex: 1, minHeight: t.minTouch }]}
              />
              <Pressable
                onPress={commitNewCategory}
                disabled={!normalizeCategory(newCategory)}
                accessibilityRole="button"
                accessibilityLabel="Add category"
                hitSlop={8}
                style={{ paddingHorizontal: 6, opacity: normalizeCategory(newCategory) ? 1 : 0.35 }}
              >
                <Ionicons name="add-circle" size={26} color={c.accentText} />
              </Pressable>
            </View>
          </View>

          <View style={{ gap: t.space.sm }}>
            <Text accessibilityRole="header" style={[textStyle("eyebrow"), { color: c.textTertiary }]}>
              Tags
            </Text>
            <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>
              What is true about it. As many as fit — {draftTags.length} of {MAX_TAGS} used.
            </Text>
            <View style={styles.field}>
              {tagChoices.length === 0 ? (
                <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
                  No tags in your library yet. Add the first one below.
                </Text>
              ) : (
                tagChoices.map((tag) => {
                  const on = hasTag(draftTags, tag);
                  return (
                    <Pill
                      key={tag}
                      label={tag}
                      accessibilityRole="checkbox"
                      selected={on}
                      // At the cap an un-selected tag cannot be added, so it
                      // removes instead of silently doing nothing.
                      onPress={() => {
                        if (on) setDraftTags(removeTag(draftTags, tag));
                        else if (!atCap) setDraftTags(toggleTag(draftTags, tag));
                      }}
                    />
                  );
                })
              )}
            </View>
            {atCap ? (
              <Text style={[textStyle("footnote"), { color: c.attention }]}>
                That is the most a recipe can carry. Remove one to add another.
              </Text>
            ) : (
              <View style={[styles.entry, { borderColor: c.separatorStrong, borderRadius: t.radius.sm, backgroundColor: c.surface }]}>
                <TextInput
                  value={newTag}
                  onChangeText={setNewTag}
                  onSubmitEditing={commitNewTag}
                  placeholder="New tag"
                  placeholderTextColor={c.textTertiary}
                  returnKeyType="done"
                  autoCapitalize="words"
                  accessibilityLabel="New tag name"
                  style={[inputStyle("body"), { color: c.text, flex: 1, minHeight: t.minTouch }]}
                />
                <Pressable
                  onPress={commitNewTag}
                  disabled={!displayTag(newTag)}
                  accessibilityRole="button"
                  accessibilityLabel="Add tag"
                  hitSlop={8}
                  style={{ paddingHorizontal: 6, opacity: displayTag(newTag) ? 1 : 0.35 }}
                >
                  <Ionicons name="add-circle" size={26} color={c.accentText} />
                </Pressable>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 12 },
  field: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 14, justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  entry: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth },
});
