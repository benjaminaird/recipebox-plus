// The app's navigation: five tab destinations, with Recipe Detail and Cook
// Mode pushed above them. Navigation chrome is themed from the tokens, so the
// bars follow the appearance setting like everything else (ADR 0019).
import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer, useNavigation, type Theme as NavTheme, DefaultTheme } from "@react-navigation/native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator, type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMemo } from "react";
import { useTheme } from "../theme/ThemeProvider";
import { maxScale, textStyle } from "../theme/fonts";
import type { RootStackParamList, TabParamList } from "./types";
import { HomeScreen } from "../screens/HomeScreen";
import { RecipesScreen } from "../screens/RecipesScreen";
import { RecipeDetailScreen } from "../screens/RecipeDetailScreen";
import { CookModeScreen } from "../screens/CookModeScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { PlanScreen } from "../screens/PlanScreen";
import { ListsScreen } from "../screens/ListsScreen";
import { ShoppingListScreen } from "../screens/ShoppingListScreen";
import { RecipeEditorScreen } from "../screens/RecipeEditorScreen";
import { ImportReviewScreen } from "../screens/ImportReviewScreen";
import { AddTabButton } from "./AddTabButton";

function EditRecipeButton({ recipeId }: { recipeId: string }) {
  const t = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Pressable
      onPress={() => navigation.navigate("RecipeEditor", { recipeId })}
      accessibilityRole="button"
      accessibilityLabel="Edit this recipe"
      hitSlop={12}
      style={({ pressed }) => ({ minHeight: t.minTouch, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={[textStyle("body"), { color: t.colors.accentText, fontWeight: "600" }]}>Edit</Text>
    </Pressable>
  );
}

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

/**
 * What the centre button opens.
 *
 * Two routes in, with very different readiness. Writing a recipe works now, so
 * it leads. Importing does not, and says so rather than offering a field that
 * goes nowhere -- the one thing worse than a missing feature is a control that
 * looks finished and is not.
 */
function AddScreen() {
  const t = useTheme();
  const c = t.colors;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <ScrollView
      style={{ backgroundColor: c.canvas }}
      contentContainerStyle={{
        padding: t.space.screenGutter,
        gap: t.space.lg,
      }}
    >
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={maxScale("largeTitle")}
        style={[textStyle("largeTitle"), { color: c.text }]}
      >
        Add a recipe
      </Text>

      <Pressable
        onPress={() => {
          navigation.goBack();
          navigation.navigate("RecipeEditor", {});
        }}
        accessibilityRole="button"
        accessibilityLabel="Write a recipe yourself"
        style={({ pressed }) => [
          addStyles.card,
          { backgroundColor: c.accentSoft, borderRadius: t.radius.md, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Ionicons name="create-outline" size={24} color={c.accentText} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[textStyle("cardTitle"), { color: c.text }]}>Write it out</Text>
          <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>
            Type a recipe in: ingredients, method, the lot. Good for a card, a book, or something
            of your own.
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={() => {
          navigation.goBack();
          navigation.navigate("ImportReview", {});
        }}
        accessibilityRole="button"
        accessibilityLabel="Import from a link, and see what import review will look like"
        style={({ pressed }) => [
          addStyles.card,
          { backgroundColor: c.surface, borderRadius: t.radius.md, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Ionicons name="link-outline" size={24} color={c.textSecondary} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[textStyle("cardTitle"), { color: c.text }]}>Import from a link</Text>
          <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>
            Not connected yet. You can see exactly how a reviewed import will look, on a stored
            example.
          </Text>
        </View>
      </Pressable>

      <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
        Photos, PDFs and pasted text are planned and not built. They will appear here as they
        arrive, not before.
      </Text>
    </ScrollView>
  );
}

const addStyles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "flex-start", gap: 14, padding: 16 },
});

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
          options={({ route }) => ({
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
            headerRight: () => <EditRecipeButton recipeId={route.params.recipeId} />,
          })}
        />
        <Stack.Screen
          name="ImportReview"
          component={ImportReviewScreen}
          options={{
            presentation: "modal",
            headerShown: true,
            title: "",
            headerStyle: { backgroundColor: c.canvas },
            headerShadowVisible: false,
            headerTintColor: c.accentText,
          }}
        />
        <Stack.Screen
          name="RecipeEditor"
          component={RecipeEditorScreen}
          options={{
            presentation: "modal",
            headerShown: true,
            title: "",
            headerStyle: { backgroundColor: c.canvas },
            headerShadowVisible: false,
            headerTintColor: c.accentText,
            headerLeft: () => null,
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
