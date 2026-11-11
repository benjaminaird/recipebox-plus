// The operations a shopping list supports, in one place.
//
// Several screens reach these -- the Lists index, a list itself, Recipe Detail
// and the planner all create or extend lists -- and a second copy of "add a
// recipe to a list" would eventually disagree with the first about what
// happens to the cook's ticks.
import {
  getShoppingList, listShoppingItems, replaceGeneratedItems, saveShoppingItem,
  saveShoppingList, getRecipe,
} from "./db";
import {
  buildList, reconcileGenerated, type ShoppingItem, type ShoppingList,
  type ShoppingListSource,
} from "../domain/shoppingList";

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A readable default so a list is never called "Untitled". */
export function defaultListTitle(sources: readonly ShoppingListSource[], now = new Date()): string {
  if (sources.length === 1) return sources[0].title;
  const date = now.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `Shopping — ${date}`;
}

/**
 * Rebuild the generated half of a list from its sources.
 *
 * The cook's own items survive untouched, and a generated line that comes back
 * identical keeps its tick. A line whose text CHANGED comes back unticked,
 * which is right: if adding a recipe raised the flour from two cups to five,
 * the two cups already in the trolley are no longer the whole job.
 */
export async function rebuildList(listId: string): Promise<void> {
  const list = await getShoppingList(listId);
  if (!list) return;

  const recipes = await Promise.all(list.sources.map((s) => getRecipe(s.recipeId)));
  const buildSources = list.sources
    .map((s, i) => ({ recipe: recipes[i], scale: s.scale }))
    // A list can outlive a recipe. Dropping the missing one is better than
    // failing the whole rebuild and leaving a cook with no list at all.
    .filter((s): s is { recipe: NonNullable<typeof s.recipe>; scale: number } => s.recipe !== null);

  const built = buildList(buildSources);
  const existing = await listShoppingItems(listId);
  const { checkedTexts } = reconcileGenerated(existing, built);

  const now = Date.now();
  const items: ShoppingItem[] = built.map((b, i) => ({
    id: newId("si"),
    listId,
    text: b.text,
    category: b.category,
    checked: checkedTexts.has(b.text),
    origin: "generated",
    optional: b.optional,
    ...(b.warning ? { warning: b.warning } : {}),
    sources: b.sources,
    position: i,
    createdAt: now,
    updatedAt: now,
  }));

  await replaceGeneratedItems(listId, items, now);
}

/** Make a list from recipes, each at its own batch, and fill it. */
export async function createListFromSources(
  sources: readonly ShoppingListSource[],
  title?: string,
): Promise<string> {
  const now = Date.now();
  const list: ShoppingList = {
    id: newId("sl"),
    title: (title ?? defaultListTitle(sources)).trim() || "Shopping",
    sources: [...sources],
    createdAt: now,
    updatedAt: now,
  };
  await saveShoppingList(list);
  await rebuildList(list.id);
  return list.id;
}

/**
 * Add recipes to an existing list.
 *
 * The same recipe at the same batch twice is two meals of it, so the scales
 * add rather than one replacing the other: planning a roast on Tuesday and
 * again on Friday should buy two roasts' worth.
 */
export async function addSourcesToList(
  listId: string,
  sources: readonly ShoppingListSource[],
): Promise<void> {
  const list = await getShoppingList(listId);
  if (!list) return;
  const merged = [...list.sources];
  for (const incoming of sources) {
    const at = merged.findIndex((s) => s.recipeId === incoming.recipeId);
    if (at === -1) merged.push({ ...incoming });
    else merged[at] = { ...merged[at], scale: merged[at].scale + incoming.scale };
  }
  await saveShoppingList({ ...list, sources: merged, updatedAt: Date.now() });
  await rebuildList(listId);
}

export async function setItemChecked(item: ShoppingItem, checked: boolean): Promise<void> {
  await saveShoppingItem({ ...item, checked, updatedAt: Date.now() });
}

/**
 * Change a line's text.
 *
 * A generated line becomes the cook's the moment they edit it, so a later
 * rebuild leaves it alone. Without that, correcting "3 cups plain flour" to
 * "one bag of flour" would be silently undone by adding another recipe, and
 * nothing on screen would explain why.
 */
export async function editItemText(item: ShoppingItem, text: string): Promise<ShoppingItem | null> {
  const trimmed = text.trim();
  if (!trimmed || trimmed === item.text) return null;
  const next: ShoppingItem = { ...item, text: trimmed, origin: "manual", updatedAt: Date.now() };
  await saveShoppingItem(next);
  return next;
}

export async function addManualItem(listId: string, text: string, position: number): Promise<ShoppingItem | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const now = Date.now();
  const item: ShoppingItem = {
    id: newId("si"),
    listId,
    text: trimmed,
    // The cook's own items have no aisle we can infer without guessing, and a
    // wrong aisle is worse than none: it sends them to the wrong end of a shop.
    category: "Uncategorized",
    checked: false,
    origin: "manual",
    optional: false,
    sources: [],
    position,
    createdAt: now,
    updatedAt: now,
  };
  await saveShoppingItem(item);
  return item;
}
