# Native overnight sprint — progress

Durable record for an autonomous multi-milestone session. **If interrupted,
resume from repository state plus this file rather than repeating finished
work.** Each milestone is committed separately; the commit hashes below are the
authoritative record of what actually landed.

Branch: `feature/recipebox-2.0`. No EAS build this session. No production
changes, no merge to main.

---

## Architectural findings that shape the work

Recorded up front because they were the reason for several design choices and
would otherwise have to be rediscovered.

### ADR 0006 dictates the schema, even though sync is not being built

Sync is out of scope for this session, but the storage shapes have to be the
ones a later sync can merge, or stage 2 of ADR 0011 becomes a migration instead
of a feature. ADR 0006 is specific:

- **Meal Plan** merges *last-write-wins per day-and-meal slot*. So a planned
  meal needs its own stable id, an explicit `(date, slot)`, and its own
  `updated_at` — not a document-level timestamp.
- **Shopping List** merges as a *union of items*, with checked state
  last-write-wins per item, and a deletion that **loses to a concurrent edit**.
  So items need stable ids, per-item `updated_at`, and soft deletes.
- **Deletes are soft**, with tombstones outliving the 30-day Trash.

Every table added this session therefore carries: a client-generated stable id,
`created_at`, `updated_at`, and `deleted_at` for a tombstone. Nothing is hard
deleted.

### Dates are calendar days, not instants

A planned meal belongs to a date on a calendar, not a moment in time. Stored as
`YYYY-MM-DD` text. An epoch would move the meal across a timezone change or a
DST boundary — "Tuesday dinner" becoming Monday because the cook flew east is a
bug the storage type can prevent outright.

### Slots are part of the intended model, not an invention

The production web meal plan stores `{ [day]: recipeId[] }` with no slots and no
per-meal servings. ADR 0006 nonetheless specifies merge "per day-and-meal slot",
so slots are the accepted direction and the web storage is simply behind it. The
native model adds `slot` and `scale`. **This is local-only and changes no
production schema**; the contract a future sync would need is documented in
`docs/plan-and-lists-proposal.md`.

### Shopping-list aggregation reuses the production module, unmodified

The real aggregation algorithm is shared, not reimplemented: a list that differs
between phone and laptop is a bug found in a supermarket with a trolley.

During the overnight sprint the native app consumed `public/shopping-list.js`
where it sat, through Metro `watchFolders`, because extracting the package meant
editing production files that session could not touch. **That has since
happened** — see milestone 8 — so the module now lives in
`packages/recipe-core/src/shopping-list.js` and `public/` holds a generated
copy. The native wrappers point at the package; nothing else about the
arrangement changed.

---

## Milestones

| # | Milestone | State | Commit |
| --- | --- | --- | --- |
| 1 | Functional meal planning | **done** | `2b8aad1` |
| 2 | Functional shopping lists | **done** | `2a61255` |
| 3 | Manual recipe create and edit | **done** | `23f95d0` |
| 3b | Safe import-review architecture | **done** | `23f95d0` |
| 4 | Home integration | **done** | `bc5876a` |
| 5 | Cross-feature correctness | **done** | `8ccb50f` |
| 6 | Visual and interaction review | **done** | `318b879` |
| 7 | Documentation and final verification | **done** | `a292410` |
| 8 | Extract `packages/recipe-core` (ADR 0003) | **done** | `1c22098` |
| 9 | Correct the metric handling (ADR 0021) | **done** | `e78fc31` |
| 10 | Fetch-security hardening (SSRF, pinning, deadline) | **done** | `04c89a7`…`23d90d6` |
| 11 | Native auth design (ADR 0010) | **design only** | (this commit) |

## Baseline at session start

`cfa7aef`. 155 mobile tests, tsc clean, all seven domain regression scripts
green, Hermes bundles compile for both platforms, production web files
byte-identical to `main`.

## Milestone 1 — functional meal planning (done)

Working: a week strip for navigation with a dot on any day that has something
planned; the selected day in full, slots in the order they are eaten; add a
recipe to a slot through the shared picker; change a meal's slot, day or batch;
remove it; tap through to the recipe. Empty states say what will happen rather
than reporting a state the cook can already see.

**Verified on the simulator**, not inferred: added a meal, moved it to
tomorrow, set it to 2x, then terminated the app and read the row back; then
shut the simulator down **entirely**, cold booted, and the meal was still
there. The v4 migration left all 7 recipes, the edited tags and the in-progress
cook untouched.

15 new tests, mostly on dates. 170 total.

### Deliberately not implemented (recorded, per the brief)

- **No drag-and-drop reordering** inside a slot. `position` exists in the model
  and is honoured on read, but there is no gesture to change it. Drag would
  compete with the week strip's horizontal scroll and is poor with VoiceOver;
  "Move to" in the options sheet does the same job one-handed.
- **Moving a meal is relative** — a day earlier, a day later, a week later —
  not an arbitrary date picker. Covers the real cases (it slipped, we are away
  that night) without a calendar modal.
- **Measurement preference is not yet reflected** in Plan, because Plan shows
  no quantities. The shopping list is where it becomes visible.

## Milestone 2 — functional shopping lists (done)

Working: name a list; build one from a recipe at the batch on screen, or from
a day or a week of planned meals at each meal's own batch; add more recipes
later; tick and untick; edit a line; add and remove your own items; delete a
list. Aisle ordering and per-item provenance come from the shared module.

**Architectural note — the shared module is loaded, not copied.**
`metro.config.js` adds `../../public` to `watchFolders` and
`src/domain/webShoppingList.ts` is the single typed boundary. A static
`import` (not `require`) is what makes the same file work under both Metro and
`node --test`.

### What the production module could not do

Found by reading its unit tables. All three were **production web behaviour that
session could not change**, and all three are **now fixed** — see milestone 9
and [ADR 0021](./adr/0021-metric-and-us-customary-are-separate.md). Kept here
because the defects are what the native workarounds were shaped by:

1. **No metric volumes.** `VOLUME_TO_TSP` runs tsp → gallons and has no ml or
   litre. An unknown unit gets folded into the ingredient NAME, so "200 ml
   double cream" becomes an item called "Ml Double Cream", and "1 L stock" and
   "500 ml stock" never combine.
2. **Metric weights are shown in ounces.** 1.8 kg + 1.2 kg of beef →
   `105.82 oz Beef`.
3. **Vulgar fractions on metric units.** 3.6 kg → `3 5/8 kg`.

The native app worked around all three without touching `public/`: metric
volumes were held out and totalled natively, and metric weight lines were
re-rendered with this app's own formatting rules. **Both workarounds have since
been deleted.** The shared module is correct, so the phone had nothing left to
work around, and leaving the hold-out in place would have meant the fix never
ran on the phone at all.

### Deliberately not implemented

- **No pantry.** ADR 0011 keeps it in v1 and the brief did not ask for it in
  this milestone. Excluding staples a cook already owns needs a pantry first.
- **Items store a rendered line, not a structured quantity.** An aggregated
  line can be "1 cup + 2 Tbsp sugar"; re-deriving structure would mean parsing
  our own formatting. Editing is therefore editing the text, which is also what
  makes "editing adopts the line" simple to explain.
- **No household sync.** Out of scope by instruction; the storage shape is
  ready for it.

## Open issues, for your decision

1. ~~**Three metric defects in the shopping-list module.**~~ **Approved and
   fixed** — milestone 9 and [ADR 0021](./adr/0021-metric-and-us-customary-are-separate.md).
   One open consequence remains: **a release must bump `VERSION` in
   `public/sw.js`.** The service worker precaches `/shopping-list.js` by cache
   name, so a returning web user keeps the old module until that string changes.
   Left alone here deliberately, because this branch is not deploying.
2. **The import fetch endpoint.** Contract written, not built; security
   requirements now reviewed in
   [import-fetch-security.md](./import-fetch-security.md). The SSRF fix that
   review found is done, as are its other two findings (DNS pinning, and one
   deadline for the whole fetch rather than one per hop). What blocks the
   endpoint is ADR 0010's `/api/v1` with device-token auth, which does not
   exist. One residual limit is recorded rather than fixed: `dns.lookup` takes
   no timeout, so a single hanging resolution can still overrun the budget.
3. **A sample recipe was edited during testing.** Weeknight Tarka Dal lost its
   ground turmeric while I was proving that deleting a referenced ingredient
   leaves no dangling step references. It is a legitimate edit and the recipe
   still works; restore it from the editor if you want the sample faithful.
4. **No pantry.** ADR 0011 keeps it in v1. Excluding staples a cook already
   owns needs a pantry first, and the brief did not ask for one here.

## Milestones 3 and 3b — writing, editing, and import review (done)

Writing and editing share one screen. Ingredients split into amount / unit /
name, named parts, and per-step ingredient assignment (ADR 0012). Only a
missing name blocks a save, for the same reason ADR 0014 lets an unresolved
import be saved.

Ingredient ids are **monotonic**. A test caught that they were not: the code
took the highest id currently present, so deleting the last ingredient and
adding another reissued the id just freed. Nothing inside the recipe breaks,
but ADR 0015 keeps every prior version and a restored one would bind to a
different ingredient.

Import review runs the **production** extractor —
`public/recipe-extract.js` and `recipe-grounding.js`, loaded through the same
Metro route as the shopping module. Tests run the real extractor over stored
HTML fixtures. Fetching a page still needs a server endpoint; the contract is
in [native-import-contract.md](./native-import-contract.md) and is **not
built**.

## Milestone 4 — Home integration (done)

Today's planned meals and any unfinished shopping list, each only when it has
something to say. The focal point stays contextual. The "once Plan and Add are
built" footnote is gone, because they are.

## Milestone 5 — cross-feature correctness (done)

Tests for the seams between features, plus two structural guards: the
migration may only ever add (no DROP / ALTER / DELETE / UPDATE, every CREATE
guarded), and every new table carries the stable id, per-row `updated_at` and
tombstone that ADR 0006 will need to merge it.

Verified on the simulator end to end — wrote a recipe by hand, found it by
search, scaled it, shopped it at that batch, and read the result back from
SQLite. The water line came out as **1.8 L**: 1 L from one recipe plus 800 ml
from another at 2x, combined across recipes by code the shared module does not
have.

## Milestone 6 — visual and interaction review (done)

Reviewed in light and dark, at normal and accessibility-extra-large text. One
real defect fixed: the editor's amount field rendered "500" as a single
ellipsis at large text.

## Milestone 7 — final verification (done)

Full gate set green: tokens, sounds, typecheck, 227 mobile tests, Hermes
bundles for both platforms, all seven domain regression scripts. Production web
files byte-identical to `main`.

## Milestone 8 — extract `packages/recipe-core` (done)

ADR 0003's shared package, for real: all eight domain modules moved with
`git mv` so history follows, and the package now holds the only editable copy.

- **`server.js`, the regression scripts and the native app** resolve the modules
  from `packages/recipe-core/src/` by plain relative path. Nothing resolves the
  package name through `node_modules`, and nothing may start to: the CI domain
  job installs nothing at all, which is how the dependency-free contract is
  enforced rather than merely asserted. `build-core.js` also fails on any
  non-relative `require` inside the package, so a bare specifier cannot pass a
  developer's machine and then break CI, the browser and the phone.
- **`public/` holds generated copies.** Vercel serves `public/` as the static
  root and nothing builds on deploy, so the files the browser fetches must
  physically exist there and be committed — the same arrangement `public/app.js`
  has always been in. `npm run build:core` writes them, `npm run core:check`
  fails on drift and runs in CI, and `build:app` now runs `build:core` first so
  one command refreshes everything the browser downloads.
- **Behaviour is unchanged, and measured rather than asserted.** ADR 0003's
  precondition 1 was met with a `main` worktree: the six regression suites that
  exist on both sides produce byte-for-byte identical output before and after.
  Each module body is identical to `main` apart from a banner naming both
  files and which of them to edit — the one thing that stops someone changing
  the generated copy and losing the change on the next build.
- **`apps/web/` was not done** and is not scheduled; ADR 0003 records why.

Verified: `core:check`, all eight domain scripts, the recipe-model scorer and
evaluation, design tokens, all nineteen server scripts, a reproducible
`public/app.js`, mobile tokens / sounds / typecheck / **227 tests**, and Hermes
bundles for both platforms. Strings unique to the package
(`Household / Other`, `heaping`, `itemprop`) are present in the iOS bundle, so
Metro genuinely resolved the moved files rather than silently dropping them.

## Milestone 9 — correct the metric handling (done)

Approved as an intentional behaviour change, isolated on this branch.
[ADR 0021](./adr/0021-metric-and-us-customary-are-separate.md) records the
decision and the reasoning; the short version is that the module now has four
unit classes instead of two, metric volumes total in millilitres and metric
weights in grams, and the four never combine with each other.

- **The approved cases, asserted in the module's own regression script:**
  `1 L` + `500 ml` → `1.5 L`, `1.8 kg` + `1.2 kg` → `3 kg`, `500 g` + `250 g` →
  `750 g`, `3.6 kg` → `3.6 kg`, and `1/4 tsp salt` still reads `1/4 tsp salt`.
  Scaling is asserted at ½×, 1×, 2×, 3× and 4× across both vocabularies.
- **The native workarounds are gone.** `apps/mobile/src/domain/shoppingList.ts`
  held two: metric volumes were kept out of the shared module and totalled in
  the app, and metric weight lines were re-rendered. Both deleted, along with
  every `units.ts` import they needed — the file now contains no measurement
  arithmetic. Its metric tests were left pointed at the same behaviour and now
  exercise the shared module directly, which is the useful part: the same cases
  are checked from both ends.
- **One native behaviour changed on purpose.** A metric volume group with one
  unreadable amount (`a good splash`) used to show a single totalled line
  warning it might be short. It now keeps both lines apart with the reason, the
  same treatment a metric weight always had. Seeing "a good splash" written out
  beats a total that silently under-buys.
- **US customary output is unchanged**, asserted rather than assumed: the
  `volume` and `weight` classes keep their names, their tables and their
  formatting, so every US group key is what it was. `src/app.jsx`,
  `public/app.js`, `public/index.html`, `public/sw.js` and `vercel.json` are
  byte-identical to `main`.

Verified: `core:check`; all eight domain scripts; design tokens; nineteen server
scripts plus `smoke` and `security-smoke` against a live isolated server;
`web-preview-check` with a real browser; a reproducible `public/app.js`; mobile
tokens / sounds / typecheck / **227 tests**; and Hermes bundles for iOS and
Android. The bundles contain `volume-metric` and `weight-metric` and no longer
contain the deleted workaround's warning string, which is how we know the phone
runs the corrected module rather than its own copy. The browser's generated copy
was evaluated with no `module` in scope, so the `<script src>` branch that
actually ships was exercised, not just Node's `require`.

## Next action

Nothing queued on the metric work. The remaining open item is the
`/api/v1/import/fetch` endpoint (open issue 2). Its security requirements —
SSRF, redirects, DNS resolution, timeouts, rate limiting and response size —
are reviewed in
[import-fetch-security.md](./import-fetch-security.md). That review turned up a
live SSRF bypass in `isPrivateIp`, which `/api/fetch-url` uses today: it judged
IPv6 by its spelling, so seventeen addresses were judged public — sixteen of
them reachable through a URL, including `::ffff:7f00:1` (127.0.0.1) and
`::ffff:a9fe:a9fe` (the cloud metadata service). **Approved and fixed**: IPv6 is
now expanded to its sixteen bytes and compared numerically, which cannot have
that class of bug. Confirmed end to end both ways — eight spellings of loopback
all refused, and ten real hosts plus ten real public IPv6 addresses still
allowed.

### Milestone 10 — fetch-security hardening (done)

Five commits, each independently green, all on the branch and none deployed:

- `04c89a7` — `isPrivateIp` judged IPv6 by its spelling, so **seventeen**
  addresses that must never be fetched were judged public, sixteen of them
  reachable through a URL. Now expanded to sixteen bytes and compared
  numerically. Cross-checked against `net.BlockList` on 4,000 generated
  addresses with zero disagreements.
- `362ada5` — the guard resolved DNS and `fetch` resolved it again. The
  connection is now pinned to the addresses the guard judged, with the hostname
  left in place so TLS certificate validation is untouched.
- `4dfb9da` — the deadline stopped at the headers, so a dribbled body was
  unbounded. One deadline now covers DNS, connection, redirects **and** reading.
- `0069c9d` — the controlled DNS-rebinding scenario, with a negative control.
  With the pin removed the same test reports
  `status 200, body "PRIVATE DESTINATION REACHED"`; with it restored, zero
  connect-time resolutions and zero contacts.
- `23d90d6` — two regressions the hand-built HTTP client introduced: an
  out-of-range status (`HTTP/1.1 700`) threw a `RangeError` inside the response
  callback and crashed the process, and the WHATWG blocked-port list that
  global `fetch` enforced for free was gone, so the fetcher would speak HTTP at
  SMTP, IRC, NFS or an X server. Both fixed and both now regression tests.

An automated security review of the three middle commits found **no
vulnerabilities**; the two items in `23d90d6` came from its non-vulnerability
notes and were fixed anyway, because the hand-built client caused them.

[security-release-plan.md](./security-release-plan.md) records how to ship
these five **without** the metric change or the native client, verified by
cherry-picking them onto a throwaway branch off `main`: two files differ,
`public/shopping-list.js` is byte-identical to `main`, and eighteen suites pass.
Not executed.

### Milestone 11 — native auth design (design only)

[native-auth-design.md](./native-auth-design.md) is the ADR 0010 proposal:
`/api/v1`, opaque access tokens with rotating refresh tokens and reuse
detection, two additive tables, `expo-secure-store` for the refresh token and
memory only for the access token, and authorization that reuses the existing
household and recipe helpers so no route learns which transport reached it.
Nothing is implemented. It ends with five decisions that are not mine —
token lifetimes, whether native sign-in requires a verified email, what
`checkRateLimit` failing open should mean for token issuance, whether the web
gets device management, and whether to build before or after that review.

Two things the design had to take a view on, both found while reading:
`SESSION_DAYS = 3650` means a web session effectively never ends, which must
not be copied to a device token; and `/api/auth/signin` does not check
`email_verified`, so whether the native client matches that is a decision
rather than an oversight.

---

The review's other two findings are **also fixed**, both on live code: the
guard resolved DNS and `fetch` then resolved it again, so a short-TTL record
could answer public for the check and private for the connection — the
connection is now pinned to the addresses the guard judged, with the hostname
left in place so TLS certificate validation is untouched. And the redirect
timeout was per hop, so six stalled hops reached 54s inside a function capped at
60s; the whole fetch now has one deadline. The live `/api/fetch-url` route was
run against ten URLs on this branch and on `main` and the output is identical
for every one, which is how we know swapping the HTTP client changed no
behaviour.

What remains is ADR 0010: the endpoint needs `/api/v1` and device-token auth,
and neither exists. That is the only remaining blocker, and it is not a
security one.

### Milestone 12 — device authentication, built

The five decisions from Milestone 11 are settled (two by the user, three by me
under the rule "follow the recommendation where it is compatible and
reversible") and recorded in
[ADR 0022](./adr/0022-native-session-lifetimes-and-email-verification.md) and at
the end of [native-auth-design.md](./native-auth-design.md). `/api/v1` now
exists.

**Server** (`529c178`). `lib/device-auth.js` holds the token lifecycle over a
small store interface, with a Postgres store and an in-memory store of the same
shape; `server.js` mounts the router. Access tokens live 15 minutes, refresh
tokens 30 days rolling, and a device session ends at 180 days however often it
refreshed — the ceiling is the part worth arguing for, since a rolling window
alone makes a session permanent, which is what `SESSION_DAYS = 3650` already
does to web sessions and is not a thing to copy onto a credential in a pocket.
Rotation revokes the whole device chain on replay, with a 60-second grace
window so two refreshes racing on one phone are not mistaken for an attack.
Email verification is enforced natively and unchanged on the web; accounts
backfilled to `email_verified = true` are reported with a null
`email_verified_at` rather than being passed off as proven. A password reset or
change now revokes every device as well as every browser session. Native
sign-in draws on the web's existing rate-limit bucket rather than a second one.

**Native** (`71e0268`). `apps/mobile/src/auth/` is the client: an API client
that distinguishes "the server refused" from "the server was never reached", a
credential store backed by the Keychain and Android Keystore
(`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, never synced, never restored to another
device), and a session machine in which a network failure can never sign anyone
out and nothing can delete local data — it holds no reference to the database at
all. Two accounts on one phone are separated rather than erased: the first to
sign in adopts the library already there, anyone else gets their own store.
**No screen calls any of it yet**, so the bundle still contains none of it and
the app still does no authentication. The sign-in UI is the next milestone.

**Evidence.** Four suites: the lifecycle against both stores, the same surface
over HTTP on the real Express app, 26 client cases, and
`scripts/native-auth-e2e-test.mjs` — the app's own session manager, imported as
TypeScript, driving the real server over an ephemeral port through sign-in,
silent mid-request rotation, revocation from a second device, going offline
against a dead port, recovery without a password, and sign-out. Seven mutations
were applied one at a time and each failed a test. The Postgres store's SQL is
exercised only when `DEVICE_AUTH_TEST_DATABASE_URL` names an isolated test
database; the suite says so rather than implying coverage it has not got.

**The DNS limitation is fixed** (`d5723ab`). The fetch budget now covers
resolution. Writing that test turned up something worse than the bug: awaiting
a promise that never settles does not hang node, it exits 0 with the rest of
the file unrun — so any of these suites could have been quietly half-running in
CI. Every suite now starts failed and clears it only where it announces it
finished.

[security-release-plan.md](./security-release-plan.md) is current: six
releasable commits now, re-verified by cherry-picking them onto a throwaway
branch off `main`. Two files differ, `public/shopping-list.js` is byte-identical
to `main`, `lib/device-auth.js` and `apps/mobile` are absent, and all 24 suites
that exist on `main` pass. Still not executed, and still needing explicit
authorisation.
