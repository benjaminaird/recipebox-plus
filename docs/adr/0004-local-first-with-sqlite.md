---
status: accepted
date: 2026-10-16
---

# The phone is the source of truth: local-first storage with SQLite

RecipeBox is used in kitchens, which often have bad signal. The native client
(ADR 0001) therefore stores Recipes, Meal Plans, Shopping Lists and the Pantry in
a local SQLite database that is **authoritative for the device**, and treats the
server as a sync target rather than the origin of data. Reading, cooking,
editing, planning and shopping-list work all function with no connectivity.

The alternative — a server-authoritative API with a read-only offline cache,
which is roughly what the web app does today — was rejected because it makes a
kitchen with weak wifi a degraded kitchen, and because the import and
normalisation logic already runs on-device (ADR 0002), so the data layer was the
only thing forcing a network dependency.

## Consequences

- Every synced record needs a stable client-generated id, a revision marker and
  a soft-delete tombstone. Hard deletes cannot propagate reliably.
- Writes queue locally and retry; queued writes need idempotency keys so a retry
  cannot create a duplicate Recipe.
- Household-shared data (Meal Plan, Shopping List, Pantry) can be edited
  concurrently by different people and needs a defined merge policy. Recipes are
  single-owner and have a simpler story.
- This is the hardest part of the build and the easiest to get subtly wrong. It
  needs its own specification and its own test suite before features are built
  on top of it.

## What local-first does *not* buy us

Importing still needs the network, and usually AI. Of the import paths, only
manual entry works fully offline:

| Path | Needs network | Needs AI |
| --- | --- | --- |
| Manual entry | no | no |
| Web link with structured data | **yes** | no |
| Web link without structured data | yes | yes |
| YouTube / social post | yes | yes |
| Pasted text | no | **yes** |
| Photo, screenshot, PDF | no | **yes** |

Pasted text is the counter-intuitive one: the text is already on the device, but
structuring it currently goes straight to the model. Offline-first is about
reading, cooking and planning — not importing. The app must say so honestly
rather than appearing broken.
