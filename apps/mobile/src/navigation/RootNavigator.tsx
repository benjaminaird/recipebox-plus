// The app's navigation: five tab destinations, with Recipe Detail and Cook
// Mode pushed above them. Navigation chrome is themed from the tokens, so the
// bars follow the appearance setting like everything else (ADR 0019).
import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer, type Theme as NavTheme, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useMemo } from "react";
import { useTheme } from "../theme/ThemeProvider";
import type { RootStackParamList, TabParamList } from "./types";
import { HomeScreen } from "../screens/HomeScreen";
import { RecipesScreen } from "../screens/RecipesScreen";
import { RecipeDetailScreen } from "../screens/RecipeDetailScreen";
import { CookModeScreen } from "../screens/CookModeScreen";
import { Placeholder } from "../components/Placeholder";

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const ICONS: Record<keyof TabParamList, [IoniconName, IoniconName]> = {
  Home: ["home", "home-outline"],
  Recipes: ["book", "book-outline"],
  Add: ["add-circle", "add-circle-outline"],
  Plan: ["calendar", "calendar-outline"],
  Lists: ["cart", "cart-outline"],
};

function AddScreen() {
  return (
    <Placeholder
      title="Add a recipe"
      summary="Import is the product's core promise, so it is being built against the real reliability suite rather than mocked up here."
      planned={[
        "Paste text, and have it parsed on the device first (ADR 0007)",
        "Import from a link, a photo of a recipe card, or a PDF",
        "Review what was understood in context, with anything uncertain flagged (ADR 0014)",
        "Save a recipe even while some of it is still unresolved",
      ]}
    />
  );
}

function PlanScreen() {
  return (
    <Placeholder
      title="Plan"
      summary="The meal planner will sit on the same local store as the recipe library, so planning works offline."
      planned={[
        "A week view you can drag recipes onto",
        "Servings adjusted per planned meal",
        "Roll a plan forward into the shopping list",
      ]}
    />
  );
}

function ListsScreen() {
  return (
    <Placeholder
      title="Lists"
      summary="Shopping lists already exist as portable domain logic in the web app; the native screen will consume that same module rather than a reimplementation."
      planned={[
        "A shopping list built from planned meals",
        "Quantities combined across recipes",
        "Pantry staples kept out of the list",
      ]}
    />
  );
}

function Tabs() {
  const t = useTheme();
  const c = t.colors;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: c.accentText,
        tabBarInactiveTintColor: c.textTertiary,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.separator,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons name={ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Recipes" component={RecipesScreen} />
      <Tab.Screen name="Add" component={AddScreen} />
      <Tab.Screen name="Plan" component={PlanScreen} />
      <Tab.Screen name="Lists" component={ListsScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const t = useTheme();
  const c = t.colors;

  const navTheme = useMemo<NavTheme>(
    () => ({
      ...DefaultTheme,
      dark: t.scheme === "dark",
      colors: {
        primary: c.accentText,
        background: c.canvas,
        card: c.surface,
        text: c.text,
        border: c.separator,
        notification: c.attention,
      },
    }),
    [t.scheme, c],
  );

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.canvas },
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen
          name="RecipeDetail"
          component={RecipeDetailScreen}
          options={{
            // A native header, for the system back chevron and swipe-back.
            // The title stays empty: the screen sets the recipe title in the
            // serif at full size, and repeating it in the bar is noise.
            headerShown: true,
            title: "",
            headerBackTitle: "Recipes",
            headerTransparent: false,
            headerStyle: { backgroundColor: c.canvas },
            headerShadowVisible: false,
            headerTintColor: c.accentText,
          }}
        />
        <Stack.Screen
          name="CookMode"
          component={CookModeScreen}
          options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
