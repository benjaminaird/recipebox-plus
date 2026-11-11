// One shopping list, as it is used in a shop.
//
// Ticked items sink to the bottom, so what is left to find stays under the
// thumb. Everything is one tap: the whole row toggles, because a 44-point
// checkbox in a moving trolley is a worse target than a 44-point row.
//
// A generated line says which recipes it came from, and a line the module
// refused to combine says so. Both exist so a surprising number is
// explainable: "why does it want five cups of flour" has an answer on screen.
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeProvider";
import { inputStyle, maxScale, textStyle } from "../theme/fonts";
import { RecipePicker } from "../components/RecipePicker";
import {
  deleteShoppingItem, deleteShoppingList, getShoppingList, listShoppingItems, saveShoppingList,
} from "../data/db";
import {
  addManualItem, addSourcesToList, editItemText, setItemChecked,
} from "../data/shoppingActions";
import {
  listProgress, sortForShopping, type ShoppingItem, type ShoppingList,
} from "../domain/shoppingList";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "ShoppingList">;

export function ShoppingListScreen() {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();

  const [list, setList] = useState<ShoppingList | null | undefined>(undefined);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [editText, setEditText] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let live = true;
    Promise.all([getShoppingList(params.listId), listShoppingItems(params.listId)])
      .then(([l, i]) => { if (live) { setList(l); setItems(i); } })
      .catch(() => { if (live) setList(null); });
    return () => { live = false; };
  }, [params.listId]);

  useFocusEffect(load);

  const sorted = useMemo(() => sortForShopping(items), [items]);
  const progress = useMemo(() => listProgress(items), [items]);

  const toggle = useCallback(async (item: ShoppingItem) => {
    const next = { ...item, checked: !item.checked };
    setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)));
    await setItemChecked(item, next.checked).catch(() => {});
  }, []);

  const addManual = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const created = await addManualItem(params.listId, text, items.length);
    if (created) setItems((prev) => [...prev, created]);
  }, [draft, items.length, params.listId]);

  const commitEdit = useCallback(async () => {
    if (!editing) return;
    const next = await editItemText(editing, editText);
    if (next) setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
    setEditing(null);
  }, [editing, editText]);

  const removeItem = useCallback(async (item: ShoppingItem) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    setEditing(null);
    await deleteShoppingItem(item.id).catch(() => {});
  }, []);

  if (list === undefined) {
    return <View style={[styles.centre, { backgroundColor: c.canvas }]}><ActivityIndicator color={c.textTertiary} /></View>;
  }
  if (list === null) {
    return (
      <View style={[styles.centre, { backgroundColor: c.canvas, padding: t.space.xxl, gap: t.space.md }]}>
        <Text style={[textStyle("sectionTitle"), { color: c.text }]}>This list is gone</Text>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={[textStyle("headline"), { color: c.accentText }]}>Back to Lists</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: t.space.sm,
          paddingBottom: insets.bottom + t.space.huge,
          paddingHorizontal: t.space.screenGutter,
          gap: t.space.lg,
        }}
      >
        <View style={{ gap: t.space.xs }}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={maxScale("largeTitle")}
            style={[textStyle("largeTitle"), { color: c.text }]}
          >
            {list.title}
          </Text>
          <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
            {progress.total === 0
              ? "Nothing on it yet"
              : progress.done === progress.total
                ? "Everything got"
                : `${progress.total - progress.done} left of ${progress.total}`}
            {list.sources.length > 0
              ? ` · from ${list.sources.length} recipe${list.sources.length === 1 ? "" : "s"}`
              : ""}
          </Text>
        </View>

        {/* Adding something the cook just thought of is the most common action
            in a shop, so it is at the top and always reachable. */}
        <View style={[styles.entry, { borderColor: c.separatorStrong, borderRadius: t.radius.sm, backgroundColor: c.surface }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={addManual}
            placeholder="Add something"
            placeholderTextColor={c.textTertiary}
            returnKeyType="done"
            blurOnSubmit={false}
            accessibilityLabel="Add an item to this list"
            style={[inputStyle("body"), { color: c.text, flex: 1, minHeight: t.minTouch }]}
          />
          <Pressable
            onPress={addManual}
            disabled={!draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Add item"
            hitSlop={8}
            style={{ paddingHorizontal: 6, opacity: draft.trim() ? 1 : 0.35 }}
          >
            <Ionicons name="add-circle" size={26} color={c.accentText} />
          </Pressable>
        </View>

        {items.length === 0 ? (
          <View style={{ gap: t.space.md }}>
            <Text style={[textStyle("body"), { color: c.textSecondary }]}>
              This list is empty. Type something above, or bring in a recipe and its ingredients
              will be worked out for you.
            </Text>
          </View>
        ) : (
          sorted.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => toggle(item)}
              onLongPress={() => { setEditing(item); setEditText(item.text); }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.checked }}
              accessibilityLabel={item.text}
              accessibilityHint="Double tap to tick. Long press to edit or remove."
              style={({ pressed }) => [styles.item, { minHeight: t.minTouch, opacity: pressed ? 0.6 : 1 }]}
            >
              <Ionicons
                name={item.checked ? "checkmark-circle" : "ellipse-outline"}
                size={24}
                color={item.checked ? c.accentText : c.separatorStrong}
              />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text
                  style={[
                    textStyle("body"),
                    {
                      color: item.checked ? c.textTertiary : c.text,
                      textDecorationLine: item.checked ? "line-through" : "none",
                    },
                  ]}
                >
                  {item.text}
                </Text>
                {item.optional ? (
                  <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
                    Optional — the recipe works without it
                  </Text>
                ) : null}
                {item.warning ? (
                  <Text style={[textStyle("footnote"), { color: c.attention }]}>{item.warning}</Text>
                ) : null}
                {item.sources.length > 0 && !item.checked ? (
                  <Text style={[textStyle("footnote"), { color: c.textTertiary }]} numberOfLines={1}>
                    {item.sources.join(" · ")}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))
        )}

        <View style={{ gap: t.space.sm, marginTop: t.space.md }}>
          <Pressable
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            accessibilityLabel="Add a recipe's ingredients to this list"
            style={({ pressed }) => [
              styles.secondary,
              { borderColor: c.separatorStrong, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Ionicons name="book-outline" size={18} color={c.accentText} />
            <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>
              Add a recipe's ingredients
            </Text>
          </Pressable>

          <Pressable
            onPress={() =>
              Alert.alert(
                "Delete this list?",
                `“${list.title}” and everything on it will go.`,
                [
                  { text: "Keep it", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      await deleteShoppingList(list.id).catch(() => {});
                      navigation.goBack();
                    },
                  },
                ],
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Delete this list"
            style={({ pressed }) => [styles.secondary, { minHeight: t.minTouch, opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[textStyle("footnote"), { color: c.danger }]}>Delete this list</Text>
          </Pressable>
        </View>
      </ScrollView>

      <RecipePicker
        visible={adding}
        onClose={() => setAdding(false)}
        title="Add to this list"
        subtitle={list.title}
        onPick={async (recipe) => {
          setBusy(true);
          await addSourcesToList(params.listId, [
            { recipeId: recipe.id, title: recipe.title, scale: 1 },
          ]).catch(() => {});
          const [l, i] = await Promise.all([
            getShoppingList(params.listId),
            listShoppingItems(params.listId),
          ]);
          setList(l);
          setItems(i);
          setBusy(false);
        }}
      />

      <Modal visible={editing !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditing(null)}>
        <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: t.space.lg, paddingHorizontal: t.space.screenGutter, gap: t.space.lg }}>
          <View style={styles.sheetBar}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={1.25} style={[textStyle("sectionTitle"), { color: c.text, flex: 1 }]}>
              Edit item
            </Text>
            <Pressable onPress={() => setEditing(null)} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={12}
              style={{ minHeight: t.minTouch, justifyContent: "center" }}>
              <Text style={[textStyle("body"), { color: c.textSecondary }]}>Cancel</Text>
            </Pressable>
          </View>

          <View style={[styles.entry, { borderColor: c.separatorStrong, borderRadius: t.radius.sm, backgroundColor: c.surface }]}>
            <TextInput
              value={editText}
              onChangeText={setEditText}
              onSubmitEditing={commitEdit}
              autoFocus
              returnKeyType="done"
              accessibilityLabel="Item text"
              style={[inputStyle("body"), { color: c.text, flex: 1, minHeight: t.minTouch }]}
            />
          </View>

          {editing?.origin === "generated" ? (
            <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
              This line was worked out from your recipes. Once you change it, it is yours — adding
              another recipe to the list will leave it alone.
            </Text>
          ) : null}

          <Pressable
            onPress={commitEdit}
            accessibilityRole="button"
            accessibilityLabel="Save the change"
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: c.accent, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[textStyle("headline"), { color: c.onAccent }]}>Save</Text>
          </Pressable>

          <Pressable
            onPress={() => editing && removeItem(editing)}
            accessibilityRole="button"
            accessibilityLabel="Remove this item"
            style={({ pressed }) => [
              styles.secondary,
              { borderColor: c.separatorStrong, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={[textStyle("footnote"), { color: c.danger }]}>Remove from the list</Text>
          </Pressable>
        </View>
      </Modal>

      {busy ? (
        <View style={[styles.busy, { backgroundColor: c.scrim }]} pointerEvents="none">
          <ActivityIndicator color={c.onAccent} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  entry: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth },
  item: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 6 },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  cta: { alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  sheetBar: { flexDirection: "row", alignItems: "center", gap: 12 },
  busy: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
});
