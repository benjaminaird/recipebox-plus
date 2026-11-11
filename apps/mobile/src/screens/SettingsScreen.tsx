// Settings.
//
// Reached from a gear in Home's header, not from a sixth tab: the five
// destinations are the things a cook does, and settings is not one of them.
//
// Two rules shape what is on this screen.
//
// Every control here does something. Nothing is shown as a working switch for
// a feature that is not built, and no support address, privacy policy or
// contact link is invented to make the list look complete. The things that
// genuinely do not exist yet are named at the bottom, in a group that is
// visibly inert, so their eventual home is obvious without pretending they
// have arrived.
//
// And the screen never claims more than the OS gives us. The notification row
// states the real permission and the real caveat about silent delivery, and the
// sound preview goes through the notification system so that a cook with their
// ringer off hears exactly what a finished timer would give them: nothing.
import { Children, useCallback, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useTheme } from "../theme/ThemeProvider";
import { maxScale, textStyle } from "../theme/fonts";
import { APPEARANCE_PREFERENCES, type AppearancePreference } from "../theme/appearance";
import { useSettings } from "../settings/SettingsProvider";
import { MEASUREMENT_CHOICES, TIMER_SOUND_CHOICES } from "../settings/settings";
import { getPermission, previewTimerSound, soundCaveat, type PermissionState } from "../data/notifications";

const APPEARANCE_LABELS: Record<AppearancePreference, { label: string; detail: string }> = {
  system: { label: "Match device", detail: "Follows your Light or Dark setting" },
  light: { label: "Light", detail: "Always the cream paper theme" },
  dark: { label: "Dark", detail: "Always the dark theme" },
};

function Eyebrow({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[textStyle("eyebrow"), { color: t.colors.textTertiary }]}
    >
      {children}
    </Text>
  );
}

/** A card of hairline-separated rows. Children are rows; the separators are
 *  drawn here so no row has to know whether it is first.
 *
 *  Children.toArray, not Array.isArray. A group written as
 *  `<Group>{list.map(...)}<Row/></Group>` hands React an array whose FIRST
 *  element is itself the mapped array, so counting the top level sees two rows
 *  and draws one separator -- the mapped rows run together with no rule between
 *  them while the last one is divided off. It looks like a styling slip and is
 *  really a flattening bug. Children.toArray flattens and keys properly. */
function Group({ children, dimmed = false }: { children: React.ReactNode; dimmed?: boolean }) {
  const t = useTheme();
  const rows = Children.toArray(children);
  return (
    <View
      style={[
        styles.group,
        {
          backgroundColor: t.colors.surface,
          borderRadius: t.radius.md,
          opacity: dimmed ? 0.72 : 1,
        },
      ]}
    >
      {rows.map((row, i) => (
        <View
          key={i}
          style={i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.separator } : null}
        >
          {row}
        </View>
      ))}
    </View>
  );
}

function ChoiceRow({
  label, detail, selected, onPress,
}: { label: string; detail?: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const c = t.colors;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      style={({ pressed }) => [
        styles.row,
        { minHeight: t.minTouch, paddingVertical: t.space.md, paddingHorizontal: t.space.lg },
        pressed && { backgroundColor: c.sunken },
      ]}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[textStyle("body"), { color: c.text, fontWeight: selected ? "600" : "400" }]}>
          {label}
        </Text>
        {detail ? (
          <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>{detail}</Text>
        ) : null}
      </View>
      {/* A check, not a radio dot: it reads at a glance and needs no legend. */}
      <Ionicons
        name="checkmark"
        size={20}
        color={selected ? c.accentText : "transparent"}
        // The icon keeps its space either way, so selecting a row does not
        // reflow the text beside it.
        style={{ width: 20 }}
      />
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  const c = t.colors;
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[
        styles.row,
        t.largeText && styles.rowStacked,
        { paddingVertical: t.space.md, paddingHorizontal: t.space.lg },
      ]}
    >
      <Text style={[textStyle("body"), { color: c.text, flex: t.largeText ? undefined : 1 }]}>
        {label}
      </Text>
      <Text
        selectable
        style={[textStyle("body"), { color: c.textSecondary }, !t.largeText && styles.valueRight]}
      >
        {value}
      </Text>
    </View>
  );
}

function ActionRow({
  label, detail, action, onPress, tone = "accent",
}: {
  label: string; detail?: string; action: string; onPress: () => void;
  tone?: "accent" | "attention";
}) {
  const t = useTheme();
  const c = t.colors;
  const actionColor = tone === "attention" ? c.attention : c.accentText;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      accessibilityHint={action}
      style={({ pressed }) => [
        styles.row,
        t.largeText && styles.rowStacked,
        { minHeight: t.minTouch, paddingVertical: t.space.md, paddingHorizontal: t.space.lg },
        pressed && { backgroundColor: c.sunken },
      ]}
    >
      <View style={{ flex: t.largeText ? undefined : 1, minWidth: 0, gap: 2 }}>
        <Text style={[textStyle("body"), { color: c.text }]}>{label}</Text>
        {detail ? (
          <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>{detail}</Text>
        ) : null}
      </View>
      <Text style={[textStyle("body"), { color: actionColor, fontWeight: "600" }]}>{action}</Text>
    </Pressable>
  );
}

/** A row for something that is designed but not built. No control, and marked
 *  so it cannot be mistaken for one that is merely switched off. */
function PlannedRow({ label, detail }: { label: string; detail: string }) {
  const t = useTheme();
  const c = t.colors;
  return (
    <View
      accessible
      accessibilityLabel={`${label}. Not built yet. ${detail}`}
      style={[styles.rowStacked, { paddingVertical: t.space.md, paddingHorizontal: t.space.lg, gap: 3 }]}
    >
      <Text style={[textStyle("body"), { color: c.textSecondary }]}>{label}</Text>
      <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>{detail}</Text>
    </View>
  );
}

function permissionWording(state: PermissionState): { value: string; detail: string; action: string | null } {
  switch (state) {
    case "granted":
      return { value: "Allowed", detail: soundCaveat(), action: null };
    case "denied":
      return {
        value: "Not allowed",
        detail: "Timers still run and still show the right time when you open RecipeBox; you will not be alerted while the app is closed.",
        action: "Open Settings",
      };
    default:
      return {
        value: "Not asked yet",
        detail: "RecipeBox asks the first time you start a timer, when the question has some context.",
        action: null,
      };
  }
}

export function SettingsScreen() {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const { measurement, setMeasurement, timerSound, setTimerSound } = useSettings();
  const [permission, setPermission] = useState<PermissionState>("undetermined");

  // Re-read on focus: the cook may have just come back from the system
  // Settings app, where they could have changed it.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      getPermission().then((p) => { if (live) setPermission(p); });
      return () => { live = false; };
    }, []),
  );

  const perm = permissionWording(permission);

  const preview = useCallback(async (sound: typeof timerSound) => {
    const ok = await previewTimerSound(sound);
    if (!ok) {
      Alert.alert(
        "Nothing to play",
        permission === "granted"
          ? "The preview could not be scheduled. Timers themselves are unaffected."
          : "RecipeBox needs permission to send notifications before it can play a timer alert.",
      );
    }
  }, [permission]);

  const version = Constants.expoConfig?.version ?? "unknown";
  const build = Platform.OS === "ios"
    ? Constants.platform?.ios?.buildNumber ?? null
    : Constants.platform?.android?.versionCode?.toString() ?? null;
  const bundleId = Platform.OS === "ios"
    ? Constants.expoConfig?.ios?.bundleIdentifier ?? null
    : Constants.expoConfig?.android?.package ?? null;

  return (
    <ScrollView
      style={{ backgroundColor: c.canvas }}
      contentContainerStyle={{
        paddingTop: t.space.sm,
        paddingBottom: insets.bottom + t.space.huge,
        paddingHorizontal: t.space.screenGutter,
        gap: t.space.xxl,
      }}
    >
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={maxScale("largeTitle")}
        style={[textStyle("largeTitle"), { color: c.text }]}
      >
        Settings
      </Text>

      <View style={{ gap: t.space.sm }}>
        <Eyebrow>Appearance</Eyebrow>
        <Group>
          {APPEARANCE_PREFERENCES.map((p) => (
            <ChoiceRow
              key={p}
              label={APPEARANCE_LABELS[p].label}
              detail={APPEARANCE_LABELS[p].detail}
              selected={t.preference === p}
              onPress={() => t.setPreference(p)}
            />
          ))}
        </Group>
      </View>

      <View style={{ gap: t.space.sm }}>
        <Eyebrow>Measurements</Eyebrow>
        <Group>
          {MEASUREMENT_CHOICES.map((m) => (
            <ChoiceRow
              key={m.value}
              label={m.label}
              detail={m.detail}
              selected={measurement === m.value}
              onPress={() => setMeasurement(m.value)}
            />
          ))}
        </Group>
        <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
          How a recipe opens. You can still switch units on any recipe, and that choice is
          remembered for that recipe. The stored recipe always keeps the quantities it was
          imported with.
        </Text>
      </View>

      <View style={{ gap: t.space.sm }}>
        <Eyebrow>Timers</Eyebrow>
        <Group>
          {TIMER_SOUND_CHOICES.map((s) => (
            <ChoiceRow
              key={s.value}
              label={s.label}
              detail={s.detail}
              selected={timerSound === s.value}
              onPress={() => setTimerSound(s.value)}
            />
          ))}
          <ActionRow
            label="Hear it"
            detail="Sent as a real notification, so it is silent in exactly the cases a timer would be"
            action="Play"
            onPress={() => preview(timerSound)}
          />
        </Group>
        <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
          A timer already running keeps the sound it started with.
        </Text>
      </View>

      <View style={{ gap: t.space.sm }}>
        <Eyebrow>Notifications</Eyebrow>
        <Group>
          {perm.action ? (
            <ActionRow
              label="Timer alerts"
              detail={perm.detail}
              action={perm.action}
              tone="attention"
              onPress={() => { Linking.openSettings().catch(() => {}); }}
            />
          ) : (
            <View>
              <InfoRow label="Timer alerts" value={perm.value} />
              <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.md }}>
                <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>{perm.detail}</Text>
              </View>
            </View>
          )}
        </Group>
      </View>

      <View style={{ gap: t.space.sm }}>
        <Eyebrow>About RecipeBox</Eyebrow>
        <Group>
          <InfoRow label="Version" value={build ? `${version} (${build})` : version} />
          {bundleId ? <InfoRow label="Identifier" value={bundleId} /> : null}
          <InfoRow label="Recipes" value="Stored on this device" />
        </Group>
        <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
          RecipeBox keeps your recipes on your own device. This build has no account, no sync and
          sends nothing anywhere. Its identifier ends in .dev because it is a test build.
        </Text>
      </View>

      <View style={{ gap: t.space.sm }}>
        <Eyebrow>Not built yet</Eyebrow>
        <Group dimmed>
          <PlannedRow
            label="Account and household"
            detail="A shared library needs an account first. Nothing to sign in to in this build."
          />
          <PlannedRow
            label="Backup and export"
            detail="A portable export file is the planned backup mechanism (ADR 0009)."
          />
          <PlannedRow
            label="Recipe Helper"
            detail="The AI helper proposes changes and waits for approval (ADR 0016); it is not wired up."
          />
          <PlannedRow
            label="Support and legal"
            detail="A contact address and a privacy policy will be linked from here once they exist. We would rather leave this empty than point at something made up."
          />
        </Group>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  group: { overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowStacked: { flexDirection: "column", alignItems: "flex-start", gap: 6 },
  valueRight: { textAlign: "right", flexShrink: 1 },
});
