// RecipeBox native shell. It runs entirely on the device: no account, no
// network, no sync. Recipes come from a local SQLite database seeded with
// sample data. See README.md.
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "./src/theme/ThemeProvider";
import { serifFonts } from "./src/theme/fonts";
import { RootNavigator } from "./src/navigation/RootNavigator";

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
        <RootNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
