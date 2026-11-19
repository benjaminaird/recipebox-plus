// Deleted recipes, and the way back.
//
// Deleting a recipe on this phone does not remove it: it sets a date on the
// row and takes it out of the library. That is what makes "undo" a column
// going back to NULL rather than a restore from somewhere, and it is why a
// deletion made with no signal is still a recipe this phone can give back.
//
// The account keeps its own Trash for thirty days (ADR 0006's tombstones
// outlive it, so a device that has been away still learns about the deletion).
// This phone's Trash is not cleared on a timer: nothing here throws a recipe
// away, and a local-only recipe has nowhere else to have been kept.

import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Alert, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { textStyle } from "../theme/fonts";
import { listTrash, restoreRecipe, type TrashedRecipe } from "../data/db";
import { useSync } from "../sync/SyncProvider";
import { AuthScreen, Notice, Panel, PanelRow } from "./auth/AuthKit";

function when(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "recently";
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export function TrashScreen() {
  const t = useTheme();
  const sync = useSync();
  const [items, setItems] = useState<TrashedRecipe[] | null>(null);

  const load = useCallback(async () => { setItems(await listTrash()); }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const confirmRestore = useCallback((entry: TrashedRecipe) => {
    Alert.alert(
      `Put “${entry.recipe.title}” back?`,
      "It returns to your library exactly as it was.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Put it back",
          onPress: async () => {
            await restoreRecipe(entry.recipe.id);
            await load();
            await sync.refresh();
          },
        },
      ],
    );
  }, [load, sync]);

  return (
    <AuthScreen
      title="Trash"
      lead="Deleted recipes stay here. Nothing on this phone throws one away."
    >
      {items === null ? (
        <Text style={[textStyle("body"), { color: t.colors.textSecondary }]}>One moment…</Text>
      ) : items.length === 0 ? (
        <Notice
          message={{ title: "Nothing in the Trash", detail: "Recipes you delete will wait here.", tone: "info" }}
        />
      ) : (
        <View style={{ gap: t.space.sm }}>
          <Panel>
            {items.map((entry, index) => (
              <PanelRow
                key={entry.recipe.id}
                first={index === 0}
                label={entry.recipe.title}
                detail={`Deleted ${when(entry.deletedAt)}`}
                action="Put back"
                onPress={() => confirmRestore(entry)}
              />
            ))}
          </Panel>
          <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>
            Your account clears its own Trash after thirty days. A recipe put back here is put back there too.
          </Text>
        </View>
      )}
    </AuthScreen>
  );
}
