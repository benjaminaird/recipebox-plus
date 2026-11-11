// The live settings store.
//
// Reads are synchronous, through expo-sqlite's key-value store, for the same
// reason the appearance preference is: a setting that arrives a frame late is a
// visible flash of the wrong state. The values are small and few, so the cost
// of reading them on the first render is nil.
//
// Appearance is deliberately NOT here. It has to be applied to the native layer
// before React renders at all, so it is owned by ThemeProvider and reached
// through useTheme(). The Settings screen presents both as one list; that they
// take different routes to storage is an implementation detail and should stay
// one.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import Storage from "expo-sqlite/kv-store";
import {
  DEFAULT_SETTINGS, MEASUREMENT_KEY, TIMER_SOUND_KEY,
  parseMeasurement, parseTimerSound, type Settings, type TimerSound,
} from "./settings";
import type { Measurement } from "../domain/convert";

type SettingsContextValue = Settings & {
  setMeasurement: (m: Measurement) => void;
  setTimerSound: (s: TimerSound) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readSetting(key: string): string | null {
  try {
    return Storage.getItemSync(key);
  } catch {
    // A store that will not open leaves the defaults in effect. Settings are a
    // convenience; nothing here is recipe data, so losing one costs a
    // preference and never content.
    return null;
  }
}

function writeSetting(key: string, value: string): void {
  try {
    Storage.setItemSync(key, value);
  } catch {
    // The choice still applies for this session, from memory.
  }
}

/** Read once, at module load, before the first render. */
const initial: Settings = {
  measurement: parseMeasurement(readSetting(MEASUREMENT_KEY)),
  timerSound: parseTimerSound(readSetting(TIMER_SOUND_KEY)),
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(initial);

  const setMeasurement = useCallback((measurement: Measurement) => {
    setSettings((prev) => ({ ...prev, measurement }));
    writeSetting(MEASUREMENT_KEY, measurement);
  }, []);

  const setTimerSound = useCallback((timerSound: TimerSound) => {
    setSettings((prev) => ({ ...prev, timerSound }));
    writeSetting(TIMER_SOUND_KEY, timerSound);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({ ...settings, setMeasurement, setTimerSound }),
    [settings, setMeasurement, setTimerSound],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const v = useContext(SettingsContext);
  if (!v) throw new Error("useSettings must be used inside <SettingsProvider>");
  return v;
}

/** DEFAULT_SETTINGS re-exported so a caller outside the tree has a sane value. */
export { DEFAULT_SETTINGS };
