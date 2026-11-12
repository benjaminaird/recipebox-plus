// The pieces the account screens are built from.
//
// They exist so the five screens look like one screen seen from five angles,
// and so the decisions that matter — a field that is tall enough to hit, a
// message that is announced rather than merely shown, a button that cannot be
// pressed twice — are made once.
//
// Everything is drawn from the Modern Cookbook tokens (ADR 0018, ADR 0019):
// cream paper, the serif for anything that speaks, the system sans for
// anything that is operated. No colour is written down here.
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, type KeyboardTypeOptions, type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../theme/ThemeProvider";
import { inputStyle, maxScale, textStyle } from "../../theme/fonts";
import type { Message } from "../../auth/messages";

/**
 * The shell every account screen sits in.
 *
 * It is a plain page on the canvas rather than a card floating in the middle:
 * RecipeBox is a cookbook someone already owns, and an account is a thing they
 * are being offered, not a door they are standing outside.
 */
export function AuthScreen({
  title, lead, children, footer,
}: { title: string; lead?: string; children: ReactNode; footer?: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.colors.canvas }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          paddingTop: t.space.lg,
          paddingBottom: insets.bottom + t.space.huge,
          paddingHorizontal: t.space.screenGutter,
          gap: t.space.xxl,
        }}
      >
        <View style={{ gap: t.space.sm }}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={maxScale("largeTitle")}
            style={[textStyle("largeTitle"), { color: t.colors.text }]}
          >
            {title}
          </Text>
          {lead ? (
            <Text style={[textStyle("body"), { color: t.colors.textSecondary }]}>{lead}</Text>
          ) : null}
        </View>
        {children}
        {footer ? <View style={{ gap: t.space.md }}>{footer}</View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Something the cook needs to read: an error, a wait, a confirmation.
 *
 * Announced to a screen reader when it appears, because a sighted person sees
 * the page change and someone listening does not.
 */
export function Notice({ message }: { message: Message }) {
  const t = useTheme();
  const c = t.colors;
  const palette = message.tone === "danger"
    ? { ink: c.danger, ground: c.attentionSoft }
    : message.tone === "attention"
      ? { ink: c.attention, ground: c.attentionSoft }
      : { ink: c.accentText, ground: c.accentSoft };
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={message.detail ? `${message.title}. ${message.detail}` : message.title}
      style={{
        backgroundColor: palette.ground,
        borderRadius: t.radius.md,
        padding: t.space.lg,
        gap: t.space.xs,
      }}
    >
      <Text style={[textStyle("headline"), { color: palette.ink }]}>{message.title}</Text>
      {message.detail ? (
        <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>{message.detail}</Text>
      ) : null}
    </View>
  );
}

export function Field({
  label, hint, value, onChangeText, ...rest
}: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (next: string) => void;
  keyboardType?: KeyboardTypeOptions;
} & Omit<TextInputProps, "style" | "value" | "onChangeText">) {
  const t = useTheme();
  const c = t.colors;
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: t.space.xs }}>
      <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>{label}</Text>
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={c.textTertiary}
        selectionColor={c.accent}
        style={[
          inputStyle("body"),
          {
            color: c.text,
            backgroundColor: c.surface,
            borderRadius: t.radius.sm,
            borderWidth: focused ? 2 : StyleSheet.hairlineWidth,
            borderColor: focused ? c.focusRing : c.separatorStrong,
            // The border thickens on focus, so the padding thins to match and
            // the field does not jump by a point as it is tapped.
            paddingHorizontal: focused ? t.space.md - 1 : t.space.md,
            paddingVertical: focused ? t.space.md - 1 : t.space.md,
            minHeight: t.minTouch,
          },
        ]}
      />
      {hint ? <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>{hint}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  label, onPress, busy = false, disabled = false,
}: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const t = useTheme();
  const c = t.colors;
  const inert = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.primary,
        {
          // Disabled is a different colour, not a faded accent. A translucent
          // green still reads as a button somebody painted oddly; this reads
          // as one that is not ready yet, which is what it is.
          backgroundColor: disabled && !busy ? c.sunken : c.accent,
          borderRadius: t.radius.md,
          minHeight: Math.max(t.minTouch, 52),
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.md,
          opacity: busy ? 0.75 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {busy ? <ActivityIndicator color={c.onAccent} /> : null}
      <Text
        style={[
          textStyle("headline"),
          { color: disabled && !busy ? c.textTertiary : c.onAccent, fontWeight: "600", textAlign: "center" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A second action that is a real choice, not a dismissal. */
export function QuietButton({
  label, onPress, tone = "accent", disabled = false,
}: { label: string; onPress: () => void; tone?: "accent" | "plain" | "danger"; disabled?: boolean }) {
  const t = useTheme();
  const c = t.colors;
  const ink = tone === "danger" ? c.danger : tone === "plain" ? c.textSecondary : c.accentText;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => ({
        minHeight: t.minTouch,
        justifyContent: "center",
        alignItems: "center",
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      <Text style={[textStyle("body"), { color: ink, fontWeight: tone === "plain" ? "400" : "600" }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A hairline-separated card of rows, as Settings uses. */
export function Panel({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.colors.surface, borderRadius: t.radius.md, overflow: "hidden" }}>
      {children}
    </View>
  );
}

export function PanelRow({
  label, value, detail, action, onPress, tone = "accent", first = false,
}: {
  label: string; value?: string; detail?: string;
  action?: string; onPress?: () => void; tone?: "accent" | "danger"; first?: boolean;
}) {
  const t = useTheme();
  const c = t.colors;
  const body = (
    <View
      style={[
        styles.row,
        t.largeText && styles.rowStacked,
        { paddingVertical: t.space.md, paddingHorizontal: t.space.lg, minHeight: onPress ? t.minTouch : undefined },
      ]}
    >
      <View style={{ flex: t.largeText ? undefined : 1, minWidth: 0, gap: 2 }}>
        <Text style={[textStyle("body"), { color: c.text }]}>{label}</Text>
        {detail ? <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>{detail}</Text> : null}
      </View>
      {value ? (
        <Text selectable style={[textStyle("body"), { color: c.textSecondary }, !t.largeText && styles.valueRight]}>
          {value}
        </Text>
      ) : null}
      {action ? (
        <Text style={[textStyle("body"), { color: tone === "danger" ? c.danger : c.accentText, fontWeight: "600" }]}>
          {action}
        </Text>
      ) : null}
    </View>
  );

  const separator = first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator };
  if (!onPress) return <View style={separator}>{body}</View>;
  return (
    <View style={separator}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={detail ? `${label}. ${detail}` : label}
        accessibilityHint={action}
        style={({ pressed }) => (pressed ? { backgroundColor: c.sunken } : null)}
      >
        {body}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowStacked: { flexDirection: "column", alignItems: "flex-start", gap: 6 },
  valueRight: { textAlign: "right", flexShrink: 1 },
});
