// "Put these ingredients on a list" — from a recipe, or from a week's plan.
//
// One sheet for both, because the question is the same and the answer has the
// same two halves: an existing list, or a new one. Keeping them together also
// keeps the wording consistent, which matters more than it sounds: a cook who
// reads "Add to list" in one place and "Generate shopping list" in another has
// to work out whether those are the same thing.
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeProvider";
import { inputStyle, textStyle } from "../theme/fonts";
import { listShoppingLists, shoppingListCounts } from "../data/db";
import { addSourcesToList, createListFromSources, defaultListTitle } from "../data/shoppingActions";
import type { ShoppingList, ShoppingListSource } from "../domain/shoppingList";

export function AddToListSheet({
  visible, onClose, sources, onDone, summary,
}: {
  visible: boolean;
  onClose: () => void;
  /** What to put on the list, each at the batch it is being cooked at. */
  sources: readonly ShoppingListSource[];
  /** The id of the list that now holds them. */
  onDone: (listId: string) => void;
  /** One line saying what is about to be added, so nobody is guessing. */
  summary?: string;
}) {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const [lists, setLists] = useState<ShoppingList[] | null>(null);
  const [counts, setCounts] = useState<Record<string, { done: number; total: number }>>({});
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName("");
    setBusy(false);
    let live = true;
    Promise.all([listShoppingLists(), shoppingListCounts()])
      .then(([l, n]) => { if (live) { setLists(l); setCounts(n); } })
      .catch(() => { if (live) setLists([]); });
    return () => { live = false; };
  }, [visible]);

  const addToExisting = useCallback(async (listId: string) => {
    setBusy(true);
    await addSourcesToList(listId, sources).catch(() => {});
    setBusy(false);
    onDone(listId);
    onClose();
  }, [sources, onDone, onClose]);

  const createNew = useCallback(async () => {
    setBusy(true);
    const id = await createListFromSources(sources, name.trim() || defaultListTitle(sources));
    setBusy(false);
    onDone(id);
    onClose();
  }, [sources, name, onDone, onClose]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: t.space.lg }}>
        <View style={[styles.bar, { paddingHorizontal: t.space.screenGutter }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={1.25} style={[textStyle("sectionTitle"), { color: c.text }]}>
              Add to a list
            </Text>
            {summary ? (
              <Text numberOfLines={2} style={[textStyle("footnote"), { color: c.textSecondary }]}>
                {summary}
              </Text>
            ) : null}
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={12}
            style={{ minHeight: t.minTouch, justifyContent: "center" }}>
            <Text style={[textStyle("body"), { color: c.textSecondary }]}>Cancel</Text>
          </Pressable>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: t.space.screenGutter,
            paddingBottom: insets.bottom + t.space.huge,
            gap: t.space.xxl,
          }}
        >
          <View style={{ gap: t.space.sm }}>
            <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>New list</Text>
            <View style={[styles.entry, { borderColor: c.separatorStrong, borderRadius: t.radius.sm, backgroundColor: c.surface }]}>
              <TextInput
                value={name}
                onChangeText={setName}
                onSubmitEditing={createNew}
                placeholder={defaultListTitle(sources)}
                placeholderTextColor={c.textTertiary}
                returnKeyType="done"
                accessibilityLabel="Name for the new list"
                style={[inputStyle("body"), { color: c.text, flex: 1, minHeight: t.minTouch }]}
              />
              <Pressable
                onPress={createNew}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Create a new list with these ingredients"
                hitSlop={8}
                style={{ paddingHorizontal: 6, opacity: busy ? 0.4 : 1 }}
              >
                <Ionicons name="add-circle" size={26} color={c.accentText} />
              </Pressable>
            </View>
          </View>

          {lists === null ? (
            <ActivityIndicator color={c.textTertiary} />
          ) : lists.length > 0 ? (
            <View style={{ gap: t.space.sm }}>
              <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>Or an existing one</Text>
              {lists.map((list) => {
                const n = counts[list.id] ?? { done: 0, total: 0 };
                return (
                  <Pressable
                    key={list.id}
                    onPress={() => addToExisting(list.id)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Add to ${list.title}`}
                    style={({ pressed }) => [
                      styles.card,
                      { backgroundColor: c.surface, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed || busy ? 0.7 : 1 },
                    ]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[textStyle("cardTitle"), { color: c.text }]} numberOfLines={1}>{list.title}</Text>
                      <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>
                        {n.total === 0 ? "Empty" : `${n.total} item${n.total === 1 ? "" : "s"}`}
                      </Text>
                    </View>
                    <Ionicons name="add" size={20} color={c.accentText} />
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingBottom: 12 },
  entry: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
});
