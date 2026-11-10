// Batch scale and measurement system, as one control.
//
// Both are display choices over untouched recipe data, so nothing here edits
// anything: it reports a chosen view and the screens re-render through
// presentAmount(). The measurement selector hides options that would say
// nothing -- offering "Metric" on a recipe already written in grams is a
// control that does nothing when pressed, which teaches the cook to distrust
// the others.
import { memo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { maxScale, textStyle } from "../theme/fonts";
import type { Measurement } from "../domain/convert";
import { conversionIsUseful, SCALES, scaleLabel, type OriginalSystem, type Scale } from "../domain/present";

const MEASUREMENTS: ReadonlyArray<{ value: Measurement; label: string }> = [
  { value: "original", label: "Original" },
  { value: "us", label: "US" },
  { value: "metric", label: "Metric" },
];

function Segment({
  label, selected, onPress, accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const c = t.colors;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.segment,
        {
          backgroundColor: selected ? c.accent : c.surface,
          borderColor: selected ? c.accent : c.separatorStrong,
          borderRadius: t.radius.sm,
          minHeight: t.minTouch,
          minWidth: t.minTouch,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.6}
        style={[
          textStyle("headline"),
          { color: selected ? c.onAccent : c.textSecondary, fontWeight: selected ? "600" : "500" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export const ServingControls = memo(function ServingControls({
  scale,
  measurement,
  originalSystem,
  servings,
  onChangeScale,
  onChangeMeasurement,
}: {
  scale: Scale;
  measurement: Measurement;
  originalSystem: OriginalSystem;
  /** The recipe's own yield, so the scale can be stated in servings. */
  servings?: number;
  onChangeScale: (s: Scale) => void;
  onChangeMeasurement: (m: Measurement) => void;
}) {
  const t = useTheme();
  const c = t.colors;

  const options = MEASUREMENTS.filter((m) => conversionIsUseful(originalSystem, m.value));
  const scaledServings = servings ? Math.round(servings * scale) : null;

  return (
    <View style={{ gap: t.space.md }}>
      <View style={{ gap: t.space.xs }}>
        <View style={styles.headRow}>
          <Text style={[textStyle("eyebrow"), { color: c.textTertiary, flex: 1 }]}>Batch</Text>
          {scaledServings ? (
            <Text style={[textStyle("footnote"), { color: c.textSecondary }]} numberOfLines={1}>
              {`Makes ${scaledServings}`}
            </Text>
          ) : null}
        </View>
        <View style={styles.row}>
          {SCALES.map((s) => (
            <Segment
              key={s}
              label={scaleLabel(s)}
              selected={s === scale}
              onPress={() => onChangeScale(s)}
              accessibilityLabel={
                s === 1 ? "Original batch size" : `${scaleLabel(s)} the original batch`
              }
            />
          ))}
        </View>
      </View>

      {options.length > 1 ? (
        <View style={{ gap: t.space.xs }}>
          <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>Measurements</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {options.map((m) => (
              <Segment
                key={m.value}
                label={m.label}
                selected={m.value === measurement}
                onPress={() => onChangeMeasurement(m.value)}
                accessibilityLabel={
                  m.value === "original"
                    ? "Show the recipe's own measurements"
                    : `Show measurements in ${m.label}`
                }
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  segment: { alignItems: "center", justifyContent: "center", paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth },
});
