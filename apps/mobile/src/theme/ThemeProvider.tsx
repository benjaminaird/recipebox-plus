// Resolves the Modern Cookbook tokens for the current appearance and keeps the
// native layer in step (ADR 0019). Components read everything through useTheme();
// none of them hold a raw colour.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, Platform, useColorScheme, useWindowDimensions } from "react-native";
import * as SystemUI from "expo-system-ui";
import { colors, radius, space, typography, type ColorTokens } from "./tokens.generated";
import { artworkScale, isLargeText, minTouchTarget, nativeOverride, resolveScheme, type AppearancePreference, type Scheme } from "./appearance";
import { loadAppearancePreference, saveAppearancePreference } from "./preferenceStore";

export type Theme = {
  scheme: Scheme;
  preference: AppearancePreference;
  setPreference: (p: AppearancePreference) => void;
  colors: ColorTokens;
  typography: typeof typography;
  space: typeof space;
  radius: typeof radius;
  largeText: boolean;
  /** OS font scale, guaranteed finite and positive. Artwork steps off this. */
  fontScale: number;
  minTouch: number;
};

const ThemeContext = createContext<Theme | null>(null);

// Read once, synchronously, before the first frame, and apply it to the native
// layer immediately so system UI and the first render agree.
const initialPreference = loadAppearancePreference();
Appearance.setColorScheme(nativeOverride(initialPreference));

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<AppearancePreference>(initialPreference);
  const system = useColorScheme(); // reflects the native override and live OS changes
  const { fontScale } = useWindowDimensions();
  const scheme = resolveScheme(preference, system);

  const setPreference = useCallback((p: AppearancePreference) => {
    setPreferenceState(p);
    Appearance.setColorScheme(nativeOverride(p));
    saveAppearancePreference(p);
  }, []);

  useEffect(() => {
    // Root view background (behind every screen and during transitions).
    SystemUI.setBackgroundColorAsync(colors[scheme].canvas).catch(() => {});
  }, [scheme]);

  const theme = useMemo<Theme>(() => ({
    scheme, preference, setPreference,
    colors: colors[scheme], typography, space, radius,
    largeText: isLargeText(fontScale),
    // Never hand a NaN down: see artworkScale's note on silent layout collapse.
    fontScale: artworkScale(fontScale, Number.POSITIVE_INFINITY),
    minTouch: minTouchTarget(Platform.OS),
  }), [scheme, preference, setPreference, fontScale]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error("useTheme must be used inside <ThemeProvider>");
  return t;
}
