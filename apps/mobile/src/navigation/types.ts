// Route shapes for the whole app. Screens import these rather than typing
// navigation props inline, so a renamed route fails the type check everywhere
// it is used instead of at runtime.
import type { NavigatorScreenParams } from "@react-navigation/native";

export type TabParamList = {
  Home: undefined;
  Recipes: undefined;
  Add: undefined;
  Plan: undefined;
  Lists: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  RecipeDetail: { recipeId: string };
  CookMode: { recipeId: string };
  Settings: undefined;
  AddRecipe: undefined;
};
