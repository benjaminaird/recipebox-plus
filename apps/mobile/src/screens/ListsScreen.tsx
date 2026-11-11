// The shopping lists a cook has.
//
// An index, not a list of items: a household usually has one list going, but
// "this week" and "Christmas" are different jobs and merging them would be
// worse than keeping them apart. Progress is on every row, because the one
// thing worth knowing from here is how much is left.
import { useCallback, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeProvider";
import { inputStyle, maxScale, textStyle } from "../theme/fonts";
import { listShoppingLists, shoppingListCounts } from "../data/db";
import { createListFromSources } from "../data/shoppingActions";
import type { ShoppingList } from "../domain/shoppingList";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ListsScreen() {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [lists, setLists] = useState<ShoppingList[] | null>(null);
  const [counts, setCounts] = useState<Record<string, { done: number; total: number }>>({});
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([listShoppingLists(), shoppingListCounts()])
        .then(([l, n]) => { if (live) { setLists(l); setCounts(n); } })
        .catch(() => { if (live) setLists([]); });
      return () => { live = false; };
    }, []),
  );

  const create = useCallback(async () => {
    const title = name.trim() || "Shopping";
    setNaming(false);
    setName("");
    // An empty list, ready for manual items or for recipes added from inside.
    const id = await createListFromSources([], title);
    navigation.navigate("ShoppingList", { listId: id });
  }, [name, navigation]);

  if (!lists) {
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
          paddingHorizontal: t.space.screenGutter,
          gap: t.space.lg,
        }}
      >
        <View style={styles.head}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={maxScale("largeTitle")}
            style={[textStyle("largeTitle"), { color: c.text, flex: 1 }]}
          >
            Lists
          </Text>
          <Pressable
            onPress={() => setNaming(true)}
            accessibilityRole="button"
            accessibilityLabel="New shopping list"
            hitSlop={10}
            style={({ pressed }) => [
              styles.newBtn,
              { backgroundColor: c.accentSoft, borderRadius: t.radius.pill, minHeight: t.minTouch, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="add" size={18} color={c.accentText} />
            <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>New</Text>
          </Pressable>
        </View>

        {lists.length === 0 ? (
          <View style={{ gap: t.space.md }}>
            <Text style={[textStyle("body"), { color: c.textSecondary }]}>
              No shopping lists yet. Make one from a recipe, from a week of planned meals, or
              start an empty one and add what you need.
            </Text>
            <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
              Quantities from different recipes are added together where that is safe to do, and
              kept apart where it is not.
            </Text>
          </View>
        ) : (
          lists.map((list) => {
            const n = counts[list.id] ?? { done: 0, total: 0 };
            const complete = n.total > 0 && n.done === n.total;
            return (
              <Pressable
                key={list.id}
                onPress={() => navigation.navigate("ShoppingList", { listId: list.id })}
                accessibilityRole="button"
                accessibilityLabel={`${list.title}, ${n.done} of ${n.total} got`}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: c.surface, borderRadius: t.radius.md, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text style={[textStyle("cardTitle"), { color: c.text }]} numberOfLines={2}>
                    {list.title}
                  </Text>
                  <Text style={[textStyle("footnote"), { color: complete ? c.success : c.textSecondary }]}>
                    {n.total === 0
                      ? "Nothing on it yet"
                      : complete
                        ? "All got"
                        : `${n.total - n.done} left of ${n.total}`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.textTertiary} />
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Modal visible={naming} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setNaming(false)}>
        <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: t.space.lg, paddingHorizontal: t.space.screenGutter }}>
          <View style={styles.head}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={1.25} style={[textStyle("sectionTitle"), { color: c.text, flex: 1 }]}>
              New list
            </Text>
            <Pressable onPress={() => { setNaming(false); setName(""); }} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={12}
              style={{ minHeight: t.minTouch, justifyContent: "center" }}>
              <Text style={[textStyle("body"), { color: c.textSecondary }]}>Cancel</Text>
            </Pressable>
          </View>
          <View style={[styles.entry, { borderColor: c.separatorStrong, borderRadius: t.radius.sm, backgroundColor: c.surface, marginTop: t.space.lg }]}>
            <TextInput
              value={name}
              onChangeText={setName}
              onSubmitEditing={create}
              placeholder="What is this list for?"
              placeholderTextColor={c.textTertiary}
              autoFocus
              returnKeyType="done"
              accessibilityLabel="List name"
              style={[inputStyle("body"), { color: c.text, flex: 1, minHeight: t.minTouch }]}
            />
          </View>
          <Pressable
            onPress={create}
            accessibilityRole="button"
            accessibilityLabel="Create the list"
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: c.accent, borderRadius: t.radius.md, minHeight: t.minTouch, marginTop: t.space.lg, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[textStyle("headline"), { color: c.onAccent }]}>Create</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  newBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  entry: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth },
  cta: { alignItems: "center", justifyContent: "center", paddingVertical: 12 },
});
