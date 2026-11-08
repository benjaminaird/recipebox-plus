---
status: accepted
date: 2026-11-08
---

# The AI Recipe Helper proposes; the user approves

Recipe modification through AI is a **conversation that ends in an explicit
approval**, not a command that rewrites a recipe. The sequence is fixed:

1. The user says what they want — halve it, make it dairy-free, use what's in
   the pantry, adapt it for a different pan.
2. The Helper discusses it, in plain English, and may ask a clarifying question.
3. It presents a **proposal in plain English**: what it would change and why.
4. The user can **negotiate** — push back, adjust, ask for something different.
   The proposal is a draft, not a verdict.
5. It shows **the resulting changes concretely**, as a diff against the current
   recipe: which ingredients change, which steps change, what is added or
   removed.
6. Those changes are **validated** against the recipe model (ADR 0012) before
   being offered: references still resolve, portions still reconcile, no
   component is consumed before it is made, no ingredient is invented.
7. **Nothing is saved without the user's approval.** Approving writes a new
   version (ADR 0015), so any accepted change is revertible.

A plain-English proposal before a diff matters because a diff answers "what
changed" and not "why", and the user's judgement is about the why. Validation
sits between the proposal and the offer so the user is never asked to approve
changes that would leave the recipe internally inconsistent.

The Helper may not touch the imported original, and may not resolve an
outstanding import flag on the user's behalf — an uncertainty in the source is
not something a model should settle (ADR 0014).

Each Helper exchange that reaches a proposal spends an AI Assist; discussion
that does not produce one does not. Costs are disclosed before the model runs.
