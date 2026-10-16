---
status: accepted
date: 2026-10-16
---

# Native v1 scope, and the order sync gets built in

ADR 0005 removed the feature-parity requirement but obliges us to write
deferrals down rather than let them happen quietly. This is that list.

## Deferred

- **Master-admin console** — stays web-only, indefinitely. It is an operator
  tool, not a product surface, and there is no reason to carry it into a native
  client.
- **AI Assist purchasing and payment integration** — postponed. No payments are
  wired today and nothing in the redesign depends on them.

## Retained, including household sharing

Household sharing **stays a native v1 target.** It was proposed for deferral on
risk grounds and that proposal was rejected: household collaboration is part of
the intended RecipeBox experience, and difficulty alone is not a reason to cut
it.

Everything else ships in v1 — all Import paths, the Recipes library and its
organisation, Recipe Detail, Cook Mode, Shopping List, Meal Plan, Pantry,
nutrition, export and share, accounts and synchronisation.

## Build and test order

Risk is managed by sequencing rather than by cutting scope. Each stage must be
working and tested before the next begins:

1. **Local-first single-user functionality** — the phone works standing alone.
2. **Synchronisation across one user's devices** — proven against one person's
   phone, tablet and the web surface before any second person exists.
3. **Household sharing and conflict handling** — the element-level merge rules
   in ADR 0006, added only once single-user sync is trustworthy.
4. **Full regression, offline, recovery and real-device testing.**

This puts the hardest problem — concurrent edits by different people — last,
behind a sync layer already shown to work. It is the same risk reduction
deferral would have bought, without removing the feature.

## Reconsidering

The household v1 requirement may be revisited **if testing demonstrates
unacceptable risk or complexity** — not to accelerate a schedule. If it is
dropped later, that is a superseding ADR with evidence attached, not a quiet
descope.
