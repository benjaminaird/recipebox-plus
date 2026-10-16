---
status: accepted
date: 2026-10-16
---

# A versioned, portable library export is the backup mechanism

RecipeBox has **no backup or export feature of any kind** today. A user whose
library lives only in browser storage and who clears that browser has lost it
with no recourse. That sits badly against preserving the recipe collection being
a stated non-negotiable.

A **versioned, documented export/import format** is therefore added. It carries
everything that matters about a Recipe — content, Categories, Tags, notes,
nutrition, Source attribution and associated media — so that an export is a
genuine portable backup.

It is explicitly **not** a PDF (that is a human-readable share artifact, not a
restorable backup) and **not** an undocumented database dump (which ties the
user's data to one version of our schema). The format carries a version number
so a future RecipeBox can still read an old export.

This single feature covers three needs at once: backup, migration between
devices or surfaces, and the user's right to leave with their own data.

## Migration path for browser-only libraries

The primary route stays the existing account migration: the user creates an
account **in the browser that holds the data**, which uploads it
(`/api/auth/migrate`). This is a browser-side operation by necessity — a phone
cannot read another browser's local storage — so the native app simply signs in
afterwards. The export format is the universal fallback and the answer for
anyone who does not want an account.

A known weakness in the existing endpoint: it de-duplicates on
`recipe.id || title|createdAt` (`server.js:2531`). Recipes saved in two
different browsers carry different ids, so the same recipe merges as two.
Import needs better identity handling than this.

## Import must be non-destructive

- Duplicate detection surfaces matches and lets the user choose; it never
  silently overwrites an existing Recipe.
- A partial or failed import leaves the existing library untouched — import is
  all-or-nothing, or recoverable.
- Nothing is deleted as a side effect of importing.
