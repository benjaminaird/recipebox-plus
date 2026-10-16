# RecipeBox 2.0 — product requirements

Architecture decisions live in [docs/adr/](./adr/). This document covers the
product experience. Sections are labelled so settled decisions are never
confused with open ones.

---

## Identity — confirmed

The product is **RecipeBox** on every surface. No plus sign in the user-facing
brand; a `+` for an Add Recipe action is fine. **RecipeBox Plus** is reserved for
a future paid tier. **EverPlate** was considered and rejected.

The app icon should evoke a recipe box or recipe cards, carry no plus sign, and
work as an iPhone home-screen icon, a PWA icon and a favicon.

## Navigation — confirmed

Bottom navigation: **Home · Recipes · Add (centred) · Plan · Lists**.
Lists contains Shopping List and Pantry. Household sharing must stay reachable
without crowding the primary navigation. Secondary settings live under
appropriate menus. To be validated against the prototypes, not re-opened
casually.

## Home — confirmed

Home is a **warm, welcoming, smart, customisable landing experience** — like
opening a beautiful cookbook, not a productivity dashboard.

It is **not** a grid of buttons duplicating the bottom navigation. It surfaces
contextual content:

- an active cooking session, resumable
- tonight's planned meal
- recently saved recipes
- favourites
- recipe search

**Users control what appears and how it is prioritised.** The specific
personalisation mechanism is unresolved (see below).

## Recipes library — confirmed

Recently added first by default. Prominent search. Powerful but approachable
filtering — example facets: Dinner, Sides, Sauces, Copycat, Cookies, Bread,
Baked Goods. Finding a recipe must not require descending a hierarchy of
category screens.

The **Category / Tag distinction is preserved** in the data (Categories are
canonical food types, one per Recipe; Tags are flexible and many per Recipe —
see [GLOSSARY.md](../GLOSSARY.md)) while the *filtering experience* presents them
intuitively rather than exposing the distinction as a chore.

Empty Categories show a zero count rather than vanishing, kept behind a
"show all categories" expander so empty scaffolding never dominates a small
library.

## Recipe Detail — approved in principle, blocked on the recipe model

Priority order: compact hero, title, time and servings, then **ingredients
immediately**. By the time a Recipe is opened the decision to cook has been
made; the next question is whether the ingredients are in the house.

Each instruction step should show the ingredients, quantities and tools relevant
to *that step* — the presentation quality of
[babi.sh](https://www.babi.sh/recipes/millionaires-shortbread), on a data model
that cannot drift. **This is gated on
[ADR 0012](./adr/0012-structured-recipe-model.md) and the
[recipe model investigation](./recipe-model-investigation.md).** How compact the
hero should be is a genuine visual question for the prototypes.

## Cook Mode — confirmed

A first-class native experience, prominent and immediately accessible from every
Recipe:

- one step at a time, swipe navigation
- ingredients reachable without leaving the current step
- persistent progress across app restarts
- **multiple concurrent timers**
- timers fire via **local notifications** when backgrounded or the screen is
  locked
- haptic feedback on step change
- screen stays awake while cooking

Cook Mode uses the **same structured ingredient-to-step relationships** as Recipe
Detail. It must never hold a separate interpretation of the recipe.

## Accessibility — confirmed, foundational

Binding constraints on every design, from the first prototype:

- WCAG 2.2 AA contrast
- full OS text scaling to at least 200%, including Recipe Detail and Cook Mode
- minimum 44pt touch targets
- VoiceOver and TalkBack labels on every control

Layouts are built fluid from the start. Retrofitting text scaling means redoing
them.

## Animation — confirmed

Not a priority. Subtle transitions, responsive feedback and tasteful
microinteractions where they aid usability. No significant engineering effort on
decorative movement in the initial redesign. Performance and clarity first.

---

## Existing behaviour to preserve

Shipped in the web app and not to be lost: all Import paths (web link, YouTube,
social, pasted text, photo, screenshot, PDF, HEIC), multiple-recipe import
review, Original Source preservation, deterministic shopping-list aggregation,
Pantry and Pantry Chef, Meal Plan, tags and Quick Finds, favourites, nutrition
with per-serving/whole toggle, branded PDF export, recipe sharing, accounts with
email verification, household sharing, and offline reading.

## Unresolved

- **Home personalisation mechanism.** Reorderable cards, a chooser of which
  sections appear, or smart defaults that adapt silently? Needs a decision before
  Home is specified.
- The ten recipe-model questions in
  [recipe-model-investigation.md](./recipe-model-investigation.md).
- Whether the ~2.4s branded splash experience fits the new design.
- Visual direction — three written directions under review, then prototypes.
- Meal Plan's depth: it is shipped and retained, but how far planning develops in
  2.0 is open.

## Future possibilities

Not in scope, not designed, recorded so they are not re-discovered: richer smart
collections (Cook Again, This Week, From Your Pantry, Family Favourites), user
renaming and merging of Tags, a true offline write queue, per-recipe public share
links, on-screen-text OCR for caption-less video, and **Honeydew integration**
for household planning and grocery tasks — exploratory only, with no dependency
between the two applications and no implementation without explicit approval.
