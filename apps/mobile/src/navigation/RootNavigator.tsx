// The app's navigation: five tab destinations, with Recipe Detail and Cook
// Mode pushed above them. Navigation chrome is themed from the tokens, so the
// bars follow the appearance setting like everything else (ADR 0019).
import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer, useNavigation, type Theme as NavTheme, DefaultTheme } from "@react-navigation/native";
import { Pressable, Text } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useMemo } from "react";
import { useTheme } from "../theme/ThemeProvider";
import { textStyle } from "../theme/fonts";
import type { RootStackParamList, TabParamList } from "./types";
import { HomeScreen } from "../screens/HomeScreen";
import { RecipesScreen } from "../screens/RecipesScreen";
import { RecipeDetailScreen } from "../screens/RecipeDetailScreen";
import { CookModeScreen } from "../screens/CookModeScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { PlanScreen } from "../screens/PlanScreen";
import { ListsScreen } from "../screens/ListsScreen";
import { ShoppingListScreen } from "../screens/ShoppingListScreen";
import { Placeholder } from "../components/Placeholder";
import { AddTabButton } from "./AddTabButton";

function CloseButton() {
  const t = useTheme();
  const navigation = useNavigation();
  return (
    <Pressable
      onPress={() => navigation.goBack()}
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={12}
      style={({ pressed }) => ({ minHeight: t.minTouch, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={[textStyle("body"), { color: t.colors.accentText, fontWeight: "600" }]}>Close</Text>
    </Pressable>
  );
}

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
      underHeader
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
          // The raised Add button overhangs the bar, and a bar that clips its
          // own children would cut the circle in half.
          overflow: "visible",
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons name={ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Recipes" component={RecipesScreen} />
      <Tab.Screen
        name="Add"
        component={AddScreen}
        options={{ tabBarButton: AddTabButton, tabBarLabel: () => null }}
        listeners={({ navigation }) => ({
          // Intercept: Add is an action, so it opens over the current screen
          // instead of switching to a tab the cook would then have to leave.
          tabPress: (e) => {
            e.preventDefault();
            navigation.getParent()?.navigate("AddRecipe");
          },
        })}
      />
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
          name="ShoppingList"
          component={ShoppingListScreen}
          options={{
            headerShown: true,
            title: "",
            headerBackTitle: "Lists",
            headerStyle: { backgroundColor: c.canvas },
            headerShadowVisible: false,
            headerTintColor: c.accentText,
          }}
        />
        <Stack.Screen
          name="AddRecipe"
          component={AddScreen}
          options={{
            // A sheet, because adding a recipe is a task you finish or abandon
            // and then carry on from where you were.
            presentation: "modal",
            headerShown: true,
            title: "",
            headerStyle: { backgroundColor: c.canvas },
            headerShadowVisible: false,
            headerTintColor: c.accentText,
            // A sheet can be flicked away, but a gesture is not a control: a
            // cook who does not know it is there has no visible way out.
            headerLeft: () => <CloseButton />,
          }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            // Pushed, not a modal: the system back chevron and the swipe-back
            // gesture come free, and Settings is somewhere you leave by going
            // back rather than by dismissing.
            headerShown: true,
            title: "",
            headerBackTitle: "Home",
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
