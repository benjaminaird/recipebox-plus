// RecipeBox native shell. It runs entirely on the device: no account, no
// network, no sync. Recipes come from a local SQLite database seeded with
// sample data. See README.md.
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "./src/theme/ThemeProvider";
import { serifFonts } from "./src/theme/fonts";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { TimerProvider } from "./src/timers/TimerProvider";
import { SettingsProvider } from "./src/settings/SettingsProvider";
import { AuthProvider } from "./src/auth/AuthProvider";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [fontsLoaded, fontError] = useFonts(serifFonts);
  const ready = fontsLoaded || !!fontError; // if the serif fails, render with the system fallback rather than hang

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;
  return (
    // Gesture Handler needs a root of its own above everything that uses it.
    // Without it a GestureDetector mounts, compiles and silently never fires.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          {/* Settings sits above the timers, which read the chosen alert sound. */}
          {/* Accounts sit beside the app rather than above it: nothing here
              gates a render, and the navigator mounts whether or not there is
              a session, a server or a network. */}
          <AuthProvider>
          <SettingsProvider>
            {/* Above the navigator: a timer belongs to the session, not to the
                screen that started it, and has to survive moving between them. */}
            <TimerProvider>
              <StatusBar style="auto" />
              <RootNavigator />
            </TimerProvider>
          </SettingsProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
