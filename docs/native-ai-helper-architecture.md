# The AI Recipe Helper: what exists, and where the boundary sits

Milestone C, phase 1. Written before any Helper code, from reading what is
already here: [ADR 0016](adr/0016-ai-recipe-helper.md),
[ADR 0017](adr/0017-model-selection-is-measured.md),
[ADR 0012](adr/0012-structured-recipe-model.md),
[ADR 0015](adr/0015-recipe-version-history.md), the `/api/ai` proxy in
`server.js`, the web app's Recipe Adjustment, `lib/recipe-sync.js`, and
`scripts/recipe-model/`.

## What already works and is worth keeping

**The metering apparatus around `/api/ai` is the most valuable thing here.**
`server.js` already has, for every AI call: session authentication, plan
entitlements, per-IP and per-user daily limits, a burst guard, a per-feature
AI Assist price (`adjust` costs 2), a balance check before the call, a global
emergency switch, a monthly cost cap, a 55-second provider timeout, usage
logging with token counts, a debit only after success, and a refund if
anything fails after the debit. A feature kill switch (`AI_ADJUST_ENABLED`)
already exists for adjustments specifically. **None of this gets rebuilt.**
The Helper endpoint reuses it.

**The model allowlist and output clamp** (`sanitizeAiBody`, `ALLOWED_AI_MODELS`,
`MAX_AI_OUTPUT_TOKENS`) exist because `/api/ai` forwards a client-supplied body
to the provider, so the client could otherwise pick an expensive model. Both
are reused.

**The validator already exists.** `scripts/recipe-model/validate.js` was written
for ADR 0016 step 6 and is exercised by 13 recorded candidates in
`tests/recipe-model/adjustments/crumble-bars.adjust.json`, which CI runs with no
`npm install`. It checks unresolved references, invented ingredients, silent
removals, portions exceeding the listed total, step wording disagreeing with a
step's portion, a preparation consumed before the step that makes it, scaling
that moved a time or a temperature, and attribution being edited. It is pure and
dependency-free. It is in the wrong *place* — under `scripts/`, so only the
harness can reach it — but it is the right code.

**Server-side version history exists.** `lib/recipe-sync.js` has
`readVersions` and `revertToVersion`, exposed as
`GET /api/v1/recipes/:recipeId/versions` and
`POST /api/v1/recipes/:recipeId/revert`. Versions are append-only, each carries
a cause (`imported`, `edited`, `deleted`), and `recipe_versions` deliberately
survives a recipe delete.

## What does not work, and why it can't be the foundation

**The web app's Recipe Adjustment is the shape ADR 0016 rejects.** One text
field, one "Apply", and `ADJUST_PROMPT` asks the model to "Modify the provided
RecipeBox recipe JSON … Return ONLY one complete raw JSON object". Then
`runAIAdjust` keeps whatever comes back if it has a title and an array of
sections. Measured against the ADR's seven steps:

| ADR 0016 | Web today |
|---|---|
| 2. discusses it, may ask a clarifying question | no conversation at all |
| 3. a plain-English proposal | none; the preview shows only the new title |
| 4. the user can negotiate | no; the only choices are Save and Discard |
| 5. shows the changes concretely, as a diff | no diff exists |
| 6. validated against the recipe model | no validation; `validate.js` is never called by the app |
| 7. approving writes a new version | writes a **new recipe** with `id: uid()` |

The last row is the one that bites. "Save as new version" calls `onImport` with
a fresh id, so an adjusted recipe is a second, unrelated recipe in the library,
and the original has no record that it was adjusted. ADR 0015 is not involved.

**A whole-recipe return cannot be validated.** This is the structural reason the
native Helper does not copy the web's approach rather than a matter of taste.
When the model hands back an entire recipe, nothing can distinguish the change
the cook asked for from drift the model introduced along the way: a rewritten
step 4, a dropped `source`, renumbered ingredient ids, a quantity quietly
rounded. The existing validator needs `change.added` and `change.removed`
declared separately precisely because the candidate recipe alone does not say
what was *meant*. A model that both proposes the change and declares what it
changed can make the two agree while being wrong about both.

## The decision: the model returns a patch, not a recipe

The Helper's model output is a **proposal**: a plain-English summary, declared
tradeoffs and uncertainties, an optional clarifying question, and a list of
**operations** over an allowlisted set:

```
set-ingredient-amount   { id, amount, unit? }
substitute-ingredient   { id, name, amount?, unit? }      ← keeps the id
add-ingredient          { sectionIndex, afterId?, name, amount?, unit? }
remove-ingredient       { id }
set-step-text           { id, text }
set-step-refs           { id, refs: [id | { id, amount, unit }] }
add-step                { sectionIndex, afterId?, text, refs? }
remove-step             { id }
set-field               { field, value }   ← allowlist, never `source` or `id`
```

Three consequences follow from the shape alone, with no reliance on the model
behaving:

- **The diff is the proposal.** There is nothing to compute by comparing two
  recipes and guessing which differences were intended.
- **The declaration and the change are the same object**, so they cannot
  disagree. `validate`'s `added`/`removed` are derived from the operations.
- **Anything not named in an operation is untouched**, because applying a
  proposal is deterministic code in the shared package. The model cannot alter
  attribution, media, ids, or `createdAt` — not because the prompt asks it not
  to, but because no operation can express it.

A substitution keeps the ingredient's id and changes its name. Expressed as a
removal plus an addition it would break every step that references it; expressed
as a rename in place it cannot.

## One implementation, in the shared core

`packages/recipe-core/src/recipe-adjust.js`, pure UMD, dependency-free, like its
eight siblings:

- `proposalTool()` — the constrained-output schema, as `recipe-schema` does for
  extraction.
- `readProposal(raw)` — parse and shape-check: unknown operation kinds, ids that
  are not in the base, non-allowlisted fields, and oversized payloads are
  rejected here, before anything is applied.
- `applyProposal(base, proposal)` — deterministic; assigns ids for added
  ingredients and steps itself.
- `describeProposal(base, proposal)` — the rows the review screen draws.
- `checkProposal(base, proposal)` — apply, then run the model validator, and
  return the violations.
- `validate(base, candidate, change)` — moved here verbatim from
  `scripts/recipe-model/validate.js`.

The move is behaviour-preserving by construction: `scripts/recipe-model/validate.js`
becomes a re-export, so the harness's 13 recorded expectations now test the
shipped module. The web app, the Express backend and the native client all reach
the same copy, which is what "no competing adjustment logic" has to mean to be
worth anything. The web app is not rewritten in this milestone, but when its
Recipe Adjustment is replaced it has one place to call.

## The server/client boundary

**The device never holds a provider key and never calls a provider.** That is
already true of the web app and stays true here.

**The web proxy's shape cannot be used for the Helper.** `/api/ai` forwards a
client-composed body to Anthropic and reads nothing in the response but tokens
and errors. A server that does not know what a valid proposal looks like cannot
validate one, so ADR 0016 step 6 — validation *between* the proposal and the
offer — is unreachable through a passthrough. It also puts the prompt in the
client bundle, where it can be replaced.

So the native Helper gets a **task endpoint**, not a proxy:

```
POST /api/v1/recipes/:recipeId/helper        requireDeviceAuth (ADR 0010)
```

The server owns the system prompt, the proposal schema, the parse, and the
validation. It returns a structured proposal or a refusal — never a recipe, and
never a database write.

**Why the recipe travels in the request body.** Uploads are off by default
(`apps/mobile/src/sync/flags.ts`), and the app is local-first by ADR 0004, so for
most recipes the cloud holds nothing: the device is the system of record. The
endpoint therefore takes the recipe from the device. What the server authorizes
is consequently narrower than it sounds, and worth stating plainly:

- the account is authenticated, verified and entitled, and can cover the AI
  Assist cost — this is the real gate;
- when the recipe id *is* known to the cloud, it must belong to this account or
  be shared with it; a recipe id belonging to someone else is refused even
  though the body was supplied by the caller, so a leaked id cannot be used to
  attribute spend or log a title against another account;
- a household member may ask the Helper about a shared recipe they do not own,
  because accepting a proposal writes to **their own copy** (A3's Save My Own
  Copy), never to the owner's recipe. Only the owner may edit the original.

**Prompt injection.** Recipe text is untrusted: it came from a web page, a
photographed card or a paste. The system prompt states that the recipe block is
data, but the prompt is not the defence — the operation allowlist is. An
instruction hidden in an ingredient name cannot cause a write the operation set
cannot express, cannot reach `source` (no operation names it), cannot invent an
ingredient without that showing in the diff as an addition, and cannot save
anything at all, because saving requires the cook to tap Accept on the device.

**What is not stored.** The server keeps the conversation only for the lifetime
of the request. The request carries the turns the device holds; the server logs
the usage row it already logs for every AI call (feature, model, token counts,
success) and does not persist recipe text or conversation content.

## Model evaluation (ADR 0017)

The harness stays at **$0 in CI** and gains a third thing to score beside
extraction and the recorded adjustment candidates: **adjustment tasks**. A task
is a base recipe, a request in the cook's words, and deterministic assertions
about what any acceptable answer must and must not do — "the gluten-free
proposal must remove the all-purpose flour and must not change the oven
temperature", "the lower-sugar proposal must not reduce the yeast". Scored by
the validator plus the task's own assertions, so a model's answer is judged by
code, not by reading it.

Candidates run only when a provider key is present. Without one — which is CI,
always — the harness scores the recorded candidates exactly as today and lists
the live tasks under `pendingPaid`, the mechanism already used for the paid
import paths. ADR 0017's measurement therefore has its apparatus ready and
spends nothing.

**Live measurement needs approval and is not taken in this milestone.** The
proposed bake-off, its cost and the credentials it needs are written up in
[docs/ai-helper-evaluation-plan.md](ai-helper-evaluation-plan.md) for a decision.
No model is named as the production choice on the strength of simulated
responses: a fixture answer proves the pipeline, never the model.

## Native version history, which does not exist yet

Phase 4 wants an accepted proposal to create a recoverable version. The server
has that; **the device has none of it** — no local versions table, no history
screen, no call to either `/versions` endpoint. An accepted proposal on an
offline phone must still be revertible, so history is local-first like
everything else: an append-only `recipe_versions` table in the device's SQLite,
written on every change with its cause, and a revert that writes a new version
rather than deleting one. That is ADR 0015 for the native client, and the Helper
is the first feature that needs it rather than the reason for it.
