// The way into the timer sheet, from any screen that needs one.
//
// It states the most urgent thing rather than a generic icon: a finished
// timer shows as finished, a running one shows its countdown. A cook glancing
// at a phone across a kitchen should not have to open anything to know.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { textStyle } from "../theme/fonts";
import { formatRemaining, remainingMs } from "../domain/timer";
import { useTimers } from "./TimerProvider";

export function TimerButton({ onPress, compact = false }: { onPress: () => void; compact?: boolean }) {
  const t = useTheme();
  const c = t.colors;
  const { timers, now } = useTimers();

  const finished = timers.find((x) => x.status === "done");
  const running = timers.find((x) => x.status === "running");
  const soonest = finished ?? running;

  const label = finished
    ? "Timer finished"
    : running
      ? formatRemaining(remainingMs(running, now))
      : "Timers";

  const tone = finished ? c.attention : running ? c.accentText : c.textSecondary;
  const ground = finished ? c.attentionSoft : running ? c.accentSoft : c.surface;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        finished ? "A timer has finished. Open timers."
          : running ? `Timers, ${formatRemaining(remainingMs(running, now))} remaining`
            : "Open timers"
      }
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: ground,
          borderColor: soonest ? "transparent" : c.separatorStrong,
          borderRadius: 999,
          minHeight: t.minTouch,
          paddingHorizontal: compact ? 12 : 14,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {soonest ? <View style={[styles.dot, { backgroundColor: tone }]} /> : null}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.4}
        style={[
          textStyle("footnote"),
          { color: tone, fontWeight: "600", fontVariant: running && !finished ? ["tabular-nums"] : undefined },
        ]}
      >
        {label}
      </Text>
      {timers.length > 1 ? (
        <Text style={[textStyle("footnote"), { color: tone }]}>{`+${timers.length - 1}`}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: StyleSheet.hairlineWidth },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});
