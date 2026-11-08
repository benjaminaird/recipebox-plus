# RecipeBox

A personal and household recipe box: it imports recipes from the places people
actually find them, stores them durably, and makes them easy to cook from.

## Language

### Product

**RecipeBox**:
The product, on every platform, with no version number or tier in the name.
_Avoid_: RecipeBox 2.0, RecipeBox Plus, RecipeBox+, EverPlate, recipebox-plus
(that is the repository, not the product)

**EverPlate**:
A rejected candidate product name. Retained only to explain existing assets and
branches; never use it for anything new.

### Recipes

**Recipe**:
One dish a person can cook: title, ingredients, directions, notes and metadata.
The unit the whole product is organised around.
_Avoid_: Card (that is a visual treatment), Entry, Item

**Import**:
Creating a Recipe from an outside source — a web page, a video, a social post,
pasted text, a photo, or a PDF.
_Avoid_: Scrape, Parse, Capture

**On-device Import**:
An Import that completes entirely on the phone, with no network and no AI
Assist. Today only manual entry qualifies.
_Avoid_: Offline import (ambiguous — it suggests any import works offline)

**Connected Import**:
An Import that needs the network, an AI Assist, or both. Every Import from a
link, video, social post, photo, PDF or pasted text is one of these. The
distinction matters because a Connected Import must fail honestly when offline
rather than appear broken.
_Avoid_: Online import, Remote import

**Source**:
Where an imported Recipe came from, preserved for attribution.
_Avoid_: Origin, Reference

**Original Source**:
The imported images or scanned pages themselves, kept alongside the cleaned
Recipe so a handwritten family card stays viewable. Distinct from Source, which
is merely the attribution.

**Preparation**:
Something a Recipe makes along the way and then uses — a cookie dough, a
caramel, a pudding mixture. It is produced by a step, never bought, and never
appears in a Shopping List. "Pudding mixture" is a Preparation; "a box of
pudding mix" is an Ingredient, and the two are not interchangeable.
_Avoid_: Component (ambiguous — it also means a section), Sub-recipe

**Portion**:
The share of an Ingredient a single step uses. A step that takes 1 cup from a
2-cup Ingredient shows 1 cup. Portions across all of an Ingredient's references
reconcile against its total; a mismatch is surfaced, never corrected silently.
_Avoid_: Amount, Quantity (those are the Ingredient's own total)

**Category**:
A real food type a Recipe belongs to — Breakfast, Entrées, Desserts. A fixed,
curated set. One per Recipe.
_Avoid_: Folder, Section

**Tag**:
A free-form descriptor of how or when a Recipe gets cooked — Quick, Air Fryer,
Copycat. Many per Recipe. Never a food type; that is a Category.
_Avoid_: Label, Keyword

**Quick Finds**:
The row of shortcuts built from the Tags a person actually has.
_Avoid_: Collections, Smart collections

### Cooking and planning

**Cook Mode**:
The hands-free, step-at-a-time cooking experience for a single Recipe, with
timers and a screen that stays awake. Always entered from a Recipe.
_Avoid_: Cooking view, Recipe mode

**Meal Plan**:
Recipes assigned to days. Can belong to a person or to a Household.
_Avoid_: Calendar, Schedule

**Shopping List**:
Ingredients aggregated from chosen Recipes into something usable in a store.
_Avoid_: Grocery list, Basket

**Pantry**:
What a person already has at home, so it can be excluded from a Shopping List.

**Pantry Chef**:
The feature that suggests Recipes from what is in the Pantry.

### Accounts

**Household**:
A group of people sharing a Meal Plan, Shopping List and Pantry. Recipes stay
owned by the person who saved them.
_Avoid_: Family, Group, Team

**AI Assist**:
One unit of user-visible AI work, spent on an action the person asked for. A
failed action costs nothing, and RecipeBox's own internal repair passes are
never charged.
_Avoid_: AI credit, Token, Call
