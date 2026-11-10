// Pure appearance rules (ADR 0019). No React Native imports, so they run under
// `node --test` as well as in the app.

export type AppearancePreference = "system" | "light" | "dark";
export type Scheme = "light" | "dark";
/** React Native 0.88's Appearance.setColorScheme argument. `auto` follows the device. */
export type NativeColorSchemeOverride = "light" | "dark" | "auto";

export const APPEARANCE_PREFERENCES: readonly AppearancePreference[] = ["system", "light", "dark"];
export const DEFAULT_APPEARANCE: AppearancePreference = "system";
export const APPEARANCE_STORAGE_KEY = "settings.appearance";

/** Reads a stored value defensively: anything unknown falls back to System. */
export function parsePreference(stored: unknown): AppearancePreference {
  return stored === "light" || stored === "dark" || stored === "system" ? stored : DEFAULT_APPEARANCE;
}

/** The scheme the app should render. A missing system value (rare, early boot) renders light. */
export function resolveScheme(preference: AppearancePreference, system: string | null | undefined): Scheme {
  if (preference === "light" || preference === "dark") return preference;
  return system === "dark" ? "dark" : "light";
}

/** What to pass to Appearance.setColorScheme so native UI (alerts, keyboard, pickers) matches. */
export function nativeOverride(preference: AppearancePreference): NativeColorSchemeOverride {
  return preference === "system" ? "auto" : preference;
}

/** Large-text layouts engage at this OS font scale (design spec §5). */
export const LARGE_TEXT_THRESHOLD = 1.35;
export function isLargeText(fontScale: number): boolean {
  return Number.isFinite(fontScale) && fontScale >= LARGE_TEXT_THRESHOLD;
}

/** Minimum touch target per platform (44 pt iOS, 48 dp Android). */
export function minTouchTarget(platform: string): number {
  return platform === "android" ? 48 : 44;
}

/** Artwork is not text, so it does not grow with Dynamic Type on its own. Marks
 *  are stepped by the OS font scale and capped, so a large-text setting enlarges
 *  the lockup without letting it overrun the header.
 *
 *  The guard is load-bearing, not defensive decoration. `useWindowDimensions()`
 *  and `PixelRatio.getFontScale()` can both hand back a non-finite value before
 *  the window has reported one, and `height: NaN` does not fail loudly: Yoga
 *  discards the whole style and the image lays out at its full intrinsic size.
 *  A 512x592 mark then covers the screen. Fall back to 1 instead. */
export const MAX_ARTWORK_SCALE = 1.5;
export function artworkScale(fontScale: unknown, max: number = MAX_ARTWORK_SCALE): number {
  if (typeof fontScale !== "number" || !Number.isFinite(fontScale) || fontScale <= 0) return 1;
  return Math.min(fontScale, max);
}
