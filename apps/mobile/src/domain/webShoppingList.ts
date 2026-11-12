// The one place the production shopping-list module is loaded.
//
// It is plain UMD JavaScript with no type declarations, and it lives outside
// this package (see metro.config.js for why). Both facts are contained here so
// that no other file needs a suppression or has to know where it is.
//
// A static `import`, not `require`: Metro bundles the CommonJS file through
// interop, and Node's ESM loader gives `module.exports` as the default export,
// so the same line works in the app and under `node --test`. `require` works
// only in the first of those, which is how this was first written and how it
// first failed.
//
// The interface below is a statement of what this app uses, not a full
// description of the module. If it drifts from the real file, the parity tests
// in test/shopping-list.test.ts and test/units.test.ts fail, because they
// exercise the real behaviour rather than this declaration.

// Expo's base tsconfig allows JavaScript, so TypeScript reads the UMD file
// directly and infers what it can. The cast below states what this app relies
// on; the parity tests prove the real module still does it.
import api from "../../../../packages/recipe-core/src/shopping-list.js";

export type WebShoppingItem = {
  id: string;
  text: string;
  category?: string;
  checked?: boolean;
  combined?: boolean;
  warning?: string;
  /** Recipes that contributed, collected from each ingredient's `source`. */
  sources?: Array<{ id: string; title: string }>;
  sourceCount?: number;
  /** The contributing lines, each keeping its own original wording. */
  parts?: Array<{
    quantity?: string;
    unit?: string;
    display_name?: string;
    preparation_note?: string;
  }>;
};

export type WebShoppingList = {
  CATEGORY_ORDER: string[];
  buildShoppingListFromSections: (
    sections: unknown[],
    options?: { scale?: number },
  ) => WebShoppingItem[];
  groupShoppingItemsByCategory: (
    items: WebShoppingItem[],
  ) => Array<{ category: string; items: WebShoppingItem[] }>;
  normalizeIngredientName: (name: string) => string;
  parseShoppingIngredient: (
    ingredient: unknown,
    sectionName?: string,
  ) => { display_name: string; normalized_ingredient_name: string; category: string };
  amountToNumber: (amount: string) => number | null;
  numberToFraction: (n: number) => string;
};

export const web: WebShoppingList = api as unknown as WebShoppingList;
