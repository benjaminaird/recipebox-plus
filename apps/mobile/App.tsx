// RecipeBox native shell (development foundation only). It renders the design
// system check screen; it has no recipe engine, no account, no network and no
// sync yet. See README.md.
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "./src/theme/ThemeProvider";
import { serifFonts } from "./src/theme/fonts";
import { DesignSystemScreen } from "./src/screens/DesignSystemScreen";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [fontsLoaded, fontError] = useFonts(serifFonts);
  const ready = fontsLoaded || !!fontError; // if the serif fails, render with the system fallback rather than hang

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StatusBar style="auto" />
        <DesignSystemScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
