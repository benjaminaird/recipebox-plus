// A single development screen that exercises the Modern Cookbook system on a
// real device: type roles, colour tokens, the typographic tile, a Cook Mode
// instruction, and the Appearance setting. It holds no recipe data beyond the
// fixed sample text below, and talks to no server.
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { textStyle } from "../theme/fonts";
import { APPEARANCE_PREFERENCES, type AppearancePreference } from "../theme/appearance";
import type { ColorName } from "../theme/tokens.generated";

const LABELS: Record<AppearancePreference, string> = { system: "System", light: "Light", dark: "Dark" };

export function DesignSystemScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const c = t.colors;

  return (
    <ScrollView
      style={{ backgroundColor: c.canvas }}
      contentContainerStyle={{ paddingTop: insets.top + t.space.md, paddingBottom: insets.bottom + t.space.huge, paddingHorizontal: t.space.screenGutter, gap: t.space.sectionGap }}
    >
      <View>
        <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>Design system check</Text>
        <Text accessibilityRole="header" style={[textStyle("largeTitle"), { color: c.text }]}>RecipeBox</Text>
        <Text style={[textStyle("subhead"), { color: c.textSecondary, marginTop: t.space.xs }]}>
          Modern Cookbook · {t.scheme === "dark" ? "Dark" : "Light"} · text {t.largeText ? "large layout" : "standard layout"}
        </Text>
      </View>

      <Section title="Appearance">
        <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={[styles.group, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
          {APPEARANCE_PREFERENCES.map((p, i) => {
            const selected = t.preference === p;
            return (
              <Pressable
                key={p}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={LABELS[p]}
                accessibilityHint={p === "system" ? "Follows your phone's light or dark setting" : undefined}
                onPress={() => t.setPreference(p)}
                style={({ pressed }) => [
                  styles.row,
                  { minHeight: Math.max(t.minTouch, 52), paddingHorizontal: t.space.lg, backgroundColor: pressed ? c.accentSoft : "transparent" },
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separatorStrong },
                ]}
              >
                <Text style={[textStyle("body"), { color: c.text, flex: 1 }]}>{LABELS[p]}</Text>
                <View style={[styles.radio, { borderColor: selected ? c.accentText : c.separatorStrong, borderWidth: selected ? 7 : 1.5 }]} />
              </Pressable>
            );
          })}
        </View>
        <Text style={[textStyle("footnote"), { color: c.textSecondary, marginTop: t.space.sm }]}>
          System follows your phone, including Automatic at sunset. Saved on this device.
        </Text>
      </Section>

      <Section title="A recipe without a photo">
        <View style={[styles.recipeRow, { gap: t.space.lg, flexDirection: t.largeText ? "column" : "row" }]}>
          <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.tile, { backgroundColor: c.tileGround, borderRadius: t.radius.md }]}>
            <Text style={{ fontFamily: "Newsreader_300Light", fontSize: 44, lineHeight: 46, color: c.tileInk }} allowFontScaling={false}>L</Text>
            <Text style={[textStyle("eyebrow"), { color: c.tileInk }]} allowFontScaling={false}>Desserts</Text>
          </View>
          <View style={{ flex: 1, gap: t.space.xs }}>
            <Text style={[textStyle("cardTitle"), { color: c.text }]}>Lemon Posset</Text>
            <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>3 hr 15 min · Serves 4</Text>
            <View style={[styles.pill, { backgroundColor: c.attentionSoft }]} accessibilityLabel="Needs checking">
              <Text style={[textStyle("footnote"), { color: c.attention, fontWeight: "600" }]}>⚠ Check</Text>
            </View>
          </View>
        </View>
      </Section>

      <Section title="Cook Mode instruction">
        <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>Caramel · Step 5 of 8</Text>
        <Text style={[textStyle("cookStep"), { color: c.text, marginTop: t.space.sm }]}>
          Stir constantly for 10–12 minutes, until the caramel thickens and turns a deep gold.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, { minHeight: 56, borderRadius: t.radius.md, backgroundColor: c.accent, opacity: pressed ? 0.9 : 1, marginTop: t.space.lg }]}
        >
          <Text style={[textStyle("headline"), { color: c.onAccent }]}>Next step</Text>
        </Pressable>
      </Section>

      <Section title="Colour tokens">
        <View style={{ gap: t.space.sm }}>
          {(["canvas", "surface", "text", "textSecondary", "accent", "accentText", "attention", "danger"] as ColorName[]).map((name) => (
            <View key={name} style={[styles.swatchRow, { gap: t.space.md }]} accessible accessibilityLabel={`${name} ${c[name]}`}>
              <View style={[styles.swatch, { backgroundColor: c[name], borderColor: c.separatorStrong, borderRadius: t.radius.sm }]} />
              <Text style={[textStyle("subhead"), { color: c.text, flex: 1 }]}>{name}</Text>
              <Text style={[textStyle("footnote"), { color: c.textSecondary, fontVariant: ["tabular-nums"] }]}>{c[name]}</Text>
            </View>
          ))}
        </View>
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View>
      <Text accessibilityRole="header" style={[textStyle("sectionTitle"), { color: t.colors.text, marginBottom: t.space.md }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center" },
  radio: { width: 22, height: 22, borderRadius: 11 },
  recipeRow: { alignItems: "flex-start" },
  tile: { width: 88, height: 88, padding: 10, justifyContent: "space-between" },
  pill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  button: { alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  swatchRow: { flexDirection: "row", alignItems: "center" },
  swatch: { width: 32, height: 32, borderWidth: StyleSheet.hairlineWidth },
});
