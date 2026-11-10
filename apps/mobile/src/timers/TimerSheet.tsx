// Timers, as a sheet over whichever screen opened it.
//
// The same component serves Recipe Detail and Cook Mode, because a timer is
// not owned by either: it is started next to a step and then has to remain
// reachable once the cook has moved on.
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { maxScale, textStyle } from "../theme/fonts";
import { soundCaveat } from "../data/notifications";
import { durationLabel, QUICK_DURATIONS_MS, remainingMs, type Timer } from "../domain/timer";
import { useTimers } from "./TimerProvider";
import { formatRemaining } from "../domain/timer";

function Row({ timer, now }: { timer: Timer; now: number }) {
  const t = useTheme();
  const c = t.colors;
  const { pause, resume, restart, adjust, dismiss } = useTimers();
  const done = timer.status === "done";
  const left = remainingMs(timer, now);

  return (
    <View style={[styles.card, { backgroundColor: done ? c.attentionSoft : c.surface, borderRadius: t.radius.md }]}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[textStyle("cardTitle"), { color: c.text }]} numberOfLines={1}>
            {timer.label}
          </Text>
          <Text style={[textStyle("footnote"), { color: done ? c.attention : c.textSecondary }]}>
            {done ? "Finished" : timer.status === "paused" ? "Paused" : `of ${durationLabel(timer.durationMs)}`}
          </Text>
        </View>
        <Text
          maxFontSizeMultiplier={1.5}
          style={[
            textStyle("timer"),
            { color: done ? c.attention : c.text, fontVariant: ["tabular-nums"] },
          ]}
        >
          {formatRemaining(left)}
        </Text>
      </View>

      <View style={styles.actions}>
        {done ? (
          <>
            <Action label="Run again" onPress={() => restart(timer.id)} primary />
            <Action label="Dismiss" onPress={() => dismiss(timer.id)} />
          </>
        ) : (
          <>
            {timer.status === "running"
              ? <Action label="Pause" onPress={() => pause(timer.id)} />
              : <Action label="Resume" onPress={() => resume(timer.id)} primary />}
            <Action label="+1 min" onPress={() => adjust(timer.id, 60_000)} />
            <Action label="Cancel" onPress={() => dismiss(timer.id)} />
          </>
        )}
      </View>
    </View>
  );
}

function Action({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  const t = useTheme();
  const c = t.colors;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: primary ? c.accent : "transparent",
          borderColor: primary ? c.accent : c.separatorStrong,
          borderRadius: t.radius.sm,
          minHeight: t.minTouch,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={[textStyle("footnote"), { color: primary ? c.onAccent : c.text, fontWeight: "600" }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function TimerSheet({
  visible, onClose, recipeId, suggestions = [], suggestionsFrom = "this recipe", defaultLabel = "Timer",
}: {
  visible: boolean;
  onClose: () => void;
  recipeId?: string;
  /** Durations read out of the recipe, offered first. */
  suggestions?: number[];
  /** What the suggestions were read from, so the heading is truthful:
   *  Cook Mode offers one step's durations, Recipe Detail offers them all. */
  suggestionsFrom?: string;
  defaultLabel?: string;
}) {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const { timers, now, start, permission, clearFinished } = useTimers();
  const [custom, setCustom] = useState("");

  const addMinutes = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    start({ label: defaultLabel, durationMs: Math.round(minutes * 60_000), recipeId });
  };

  const finished = timers.filter((x) => x.status === "done").length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: t.space.lg }}>
        <View style={[styles.bar, { paddingHorizontal: t.space.screenGutter }]}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={maxScale("sectionTitle")} style={[textStyle("sectionTitle"), { color: c.text, flex: 1 }]}>
            Timers
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12} style={{ minHeight: t.minTouch, justifyContent: "center" }}>
            <Text style={[textStyle("headline"), { color: c.accentText }]}>Done</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: t.space.screenGutter,
            paddingBottom: insets.bottom + t.space.xxl,
            gap: t.space.lg,
          }}
        >
          {suggestions.length > 0 ? (
            <View style={{ gap: t.space.sm }}>
              <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>{`From ${suggestionsFrom}`}</Text>
              <View style={styles.chips}>
                {suggestions.map((ms) => (
                  <Action key={ms} label={durationLabel(ms)} primary onPress={() => start({ label: defaultLabel, durationMs: ms, recipeId })} />
                ))}
              </View>
            </View>
          ) : null}

          <View style={{ gap: t.space.sm }}>
            <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>Quick</Text>
            <View style={styles.chips}>
              {QUICK_DURATIONS_MS.map((ms) => (
                <Action key={ms} label={durationLabel(ms)} onPress={() => start({ label: defaultLabel, durationMs: ms, recipeId })} />
              ))}
            </View>
          </View>

          <View style={{ gap: t.space.sm }}>
            <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>Minutes</Text>
            <View style={styles.customRow}>
              <TextInput
                value={custom}
                onChangeText={setCustom}
                keyboardType="number-pad"
                placeholder="e.g. 12"
                placeholderTextColor={c.textTertiary}
                accessibilityLabel="Timer length in minutes"
                allowFontScaling={false}
                style={[
                  styles.input,
                  { backgroundColor: c.sunken, color: c.text, borderRadius: t.radius.sm, minHeight: t.minTouch, fontSize: 17 },
                ]}
              />
              <Action
                label="Start"
                primary
                onPress={() => { addMinutes(Number(custom)); setCustom(""); }}
              />
            </View>
          </View>

          {timers.length > 0 ? (
            <View style={{ gap: t.space.sm }}>
              <View style={styles.bar}>
                <Text style={[textStyle("eyebrow"), { color: c.textTertiary, flex: 1 }]}>Running</Text>
                {finished > 0 ? (
                  <Pressable onPress={clearFinished} accessibilityRole="button" hitSlop={8}>
                    <Text style={[textStyle("footnote"), { color: c.accentText, fontWeight: "600" }]}>
                      Clear finished
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {timers.map((timer) => <Row key={timer.id} timer={timer} now={now} />)}
            </View>
          ) : null}

          {/* Said plainly rather than implied. The OS decides whether a sound
              plays, and a kitchen timer cannot override Silent or Focus. */}
          <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
            {permission === "granted"
              ? soundCaveat()
              : permission === "denied"
                ? `Notifications are turned off, so timers will only alert you inside the app. ${soundCaveat()}`
                : "You'll be asked to allow notifications when you start your first timer."}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 12 },
  card: { padding: 14, gap: 12 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  action: { paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  customRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, paddingHorizontal: 14, paddingVertical: 10 },
});
