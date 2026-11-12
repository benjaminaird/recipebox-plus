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
  ShoppingList: { listId: string };
  RecipeEditor: { recipeId?: string } | undefined;
  ImportReview: { sampleId?: string } | undefined;
  // Accounts. Reached from Settings, never in anyone's way: the app opens to
  // the same recipes whether or not any of these are ever visited.
  Account: undefined;
  SignIn: { reason?: "expired"; email?: string } | undefined;
  CreateAccount: undefined;
  VerifyEmail: { email: string; emailSent: boolean };
  ForgotPassword: { email?: string } | undefined;
};
