---
status: accepted
date: 2026-11-08
---

# Import review happens in context, and an unresolved recipe can still be saved

Import review shows **the recipe itself**, with uncertainty marked where it
occurs — on the ingredient, on the step — rather than presenting a form of
anonymous blank fields for the user to fill. The user is reviewing a recipe they
recognise, not completing a data-entry task.

A recipe with unresolved issues is **saveable**. Blocking the save until every
flag is cleared would mean a user standing in their kitchen either abandons the
import or guesses, and a guess recorded as fact is worse than a flag carried
forward. An unresolved recipe is saved with its flags intact and can be resolved
later, including mid-cook.

## What this requires

- Uncertainty is attached to the thing it concerns and rendered beside it, so a
  flag always answers "uncertain about what?".
- A saved recipe carries its unresolved flags, which stay visible in Recipe
  Detail and Cook Mode until the user resolves them.
- Where a source is uncertain, **the source's own wording is preserved** and
  shown. The user resolves a disagreement by choosing, not by retyping.
- When extraction confidence is low, **enhancements are suppressed rather than
  guessed**: no invented servings, no estimated macros, no speculative tags. An
  empty field the user can fill beats a plausible number they will trust. This
  reverses the current web app's "never leave them 0" prompting, which produces
  confident-looking estimates on exactly the imports that deserve least trust.
- Nothing is silently resolved, and no AI pass may rewrite a quantity or a
  direction to make a recipe look cleaner.
