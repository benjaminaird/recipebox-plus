---
status: accepted
date: 2026-10-16
---

# Synchronisation and conflict policy

Local-first storage (ADR 0004) makes the phone authoritative for itself, which
means concurrent edits are normal rather than exceptional. This records how they
are resolved. The governing principle: **no Recipe content is ever silently
discarded or silently combined.**

## Revisions are server-assigned

Every synced record carries a server-issued revision. Conflict detection
compares revisions, never device clocks — phone clocks are wrong, change with
timezones, and can be set by the user. A client write that cites a revision the
server has already superseded is a conflict, not an overwrite.

## Recipes: last-write-wins, loser preserved

Recipes are single-owner. On conflict the later write becomes current and the
superseded version is **kept as a recoverable conflict copy** the user can view
and restore.

Ingredients and directions are **never** merged automatically across conflicting
versions. A machine-merged ingredient list is a recipe nobody wrote, and someone
will cook from it.

## Household data: merge at the smallest meaningful unit

Shared records (ADR: Household owns Meal Plan, Shopping List, Pantry) merge
per element, never as whole documents:

- **Shopping List** — union of items. Concurrent additions never disappear.
  Checked state resolves last-write-wins per item. A deletion loses to a
  concurrent edit of the same item, so one person cannot delete an item out from
  under another who is still working with it.
- **Meal Plan** — last-write-wins per day-and-meal slot. Tuesday dinner is
  independent of Thursday lunch.
- **Pantry** — same element-level union as the Shopping List.

Whole-document last-write-wins on a shared Shopping List would make one person's
additions vanish while they are standing in a shop. That is the single worst
failure this feature can have and the policy exists to prevent it.

## Deletion: tombstones outlive the Trash

Deletes are soft. The user sees a **30-day Trash**; the sync layer keeps
**tombstones far longer than that** (tombstones are a few bytes, so retention is
cheap and generosity costs nothing).

A device that has been offline longer than the tombstone horizon cannot be
trusted to apply a delta sync — it may hold records the server has forgotten
were deleted, and pushing them would **resurrect deleted Recipes**. Such a
device must therefore perform a **full resync against the server** rather than a
delta, with its local-only unsynced writes replayed on top. Every device records
the revision it last synced so this condition is detectable rather than
guessed at.

## Authentication while offline

Already-downloaded Recipes stay readable and cookable indefinitely, including
after the session expires. Only synchronisation and Connected Imports require a
valid session.

Local data is **scoped to the account that downloaded it**. Signing out or
switching accounts must isolate the previous account's local database so a
second person on the same device cannot reach the first person's Recipes.
Account switching never shares a local store.
