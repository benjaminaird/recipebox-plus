// Recipes that were changed in two places.
//
// The screen exists because ADR 0006 refuses to guess. When two devices change
// one recipe, the server keeps the first and refuses the second, and the
// second is not thrown away — it is here, whole, waiting for the person who
// wrote it to say what should happen to it.
//
// The language is deliberately not "conflict resolution". A cook has not done
// anything wrong, nothing is broken, and nothing has been lost; two versions
// of a recipe exist and one of them is theirs. The screen says that.

import { useCallback, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Text, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { textStyle } from "../theme/fonts";
import { useSync } from "../sync/SyncProvider";
import { summarise } from "../sync/difference";
import type { StoredConflict } from "../data/sqliteSyncStore";
import type { RootStackParamList } from "../navigation/types";
import { AuthScreen, Notice, Panel, PanelRow } from "./auth/AuthKit";

function when(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

export function ConflictsScreen() {
  const t = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const sync = useSync();
  const [list, setList] = useState<StoredConflict[] | null>(null);

  const load = useCallback(async () => {
    setList(await sync.openConflicts());
  }, [sync]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <AuthScreen
      title="Changed in two places"
      lead="Both versions of each recipe are here. Nothing has been lost, and nothing will be until you say so."
    >
      {list === null ? (
        <Text style={[textStyle("body"), { color: t.colors.textSecondary }]}>One moment…</Text>
      ) : list.length === 0 ? (
        <Notice
          message={{
            title: "Nothing to choose between",
            detail: "When a recipe is changed on two devices before they have talked to each other, it will appear here.",
            tone: "info",
          }}
        />
      ) : (
        <View style={{ gap: t.space.sm }}>
          <Panel>
            {list.map((conflict, index) => (
              <PanelRow
                key={conflict.id}
                first={index === 0}
                label={conflict.mine?.title ?? conflict.theirs?.title ?? "A recipe"}
                detail={`${summarise(conflict.mine, conflict.theirs)} Noticed ${when(conflict.detectedAt)}.`}
                action="Compare"
                onPress={() => navigation.navigate("ConflictDetail", { conflictId: conflict.id })}
              />
            ))}
          </Panel>
          <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>
            Until you choose, your version stays on this phone and the account keeps its own. Neither overwrites the other.
          </Text>
        </View>
      )}
    </AuthScreen>
  );
}
