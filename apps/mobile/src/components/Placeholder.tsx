// A destination that is reachable and designed but not yet built.
//
// The brief is explicit that unbuilt features must say so rather than mime
// working UI, so this states what will live here and marks itself clearly. It
// is a real layout in the Modern Cookbook system, not a grey box.
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { textStyle } from "../theme/fonts";

export function Placeholder({
  title,
  summary,
  planned,
}: {
  title: string;
  summary: string;
  planned: string[];
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const c = t.colors;

  return (
    <ScrollView
      style={{ backgroundColor: c.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + t.space.lg,
        paddingBottom: insets.bottom + t.space.huge,
        paddingHorizontal: t.space.screenGutter,
        gap: t.space.xxl,
      }}
    >
      <View style={{ gap: t.space.sm }}>
        <View style={[styles.badge, { backgroundColor: c.attentionSoft, borderRadius: t.radius.sm }]}>
          <Text style={[textStyle("footnote"), { color: c.attention, fontWeight: "600" }]}>Not built yet</Text>
        </View>
        <Text accessibilityRole="header" style={[textStyle("largeTitle"), { color: c.text }]}>{title}</Text>
        <Text style={[textStyle("subhead"), { color: c.textSecondary }]}>{summary}</Text>
      </View>

      <View style={{ gap: t.space.md }}>
        <Text style={[textStyle("sectionTitle"), { color: c.text }]}>What will live here</Text>
        <View style={[styles.card, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
          {planned.map((line, i) => (
            <View
              key={line}
              style={[
                styles.row,
                { paddingVertical: t.space.md, paddingHorizontal: t.space.lg },
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: c.accentText }]} />
              <Text style={[textStyle("body"), { color: c.textSecondary, flex: 1 }]}>{line}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3 },
  card: { overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 9 },
});
