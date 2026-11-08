# Ready to start M1 and M3 safely

Written 2026-11-08, after the visual direction was approved. It covers what has
to be true before **M1** (recipe-model corpus, baseline and model bake-off) and
**M3** (extract `packages/recipe-core` and prove it on Hermes) begin. The
milestone definitions come from the RecipeBox 2.0 setup session. **M2**, the
visual direction, is complete; see [Where M2 stands](#where-m2-stands).

**Rule for both milestones:** the production web app is not modified.
`src/app.jsx`, `public/`, `server.js`, `api/`, `vercel.json` and the Neon schema
stay exactly as they are on `main` until a change is explicitly approved
(`CLAUDE.md`, ADR 0005). Nothing in this branch touches them.

---

## 0. Blocker for both: push the architecture docs

ADRs **0008–0017**, `docs/product-requirements.md`,
`docs/recipe-model-investigation.md` and the November edits to `CLAUDE.md` and
`GLOSSARY.md` exist only as **local commits on the Mac**. They are on
`feature/recipebox-2.0`, ending at `6de2255`. GitHub's `feature/recipebox-2.0`
stops at `f5042d8` (ADRs 0001–0007).

M1 is defined by ADR 0012, ADR 0017 and the investigation plan, and M3 depends
on ADR 0003's preconditions. Nobody working from GitHub (a cloud session, CI,
another machine) can see the specification they are building to until those
are pushed.

**Action (you):**

1. Push `feature/recipebox-2.0` from the Mac.
2. Merge `claude/sweet-wozniak-ye7v06` into it. It only adds new files: ADRs
   0018–0020, `docs/design/`, `design/tokens/`, `scripts/design-tokens-check.js`
   and this file.
3. Follow the merge steps in
   [product-requirements-addendum-2026-11-08.md](./product-requirements-addendum-2026-11-08.md).

---

## M1: recipe-model corpus, baseline and model bake-off

**Goal:** make recipe-model accuracy measurable. Every gap in ADR 0012 gets a
fixture that fails today, the current pipeline gets a committed baseline, and
ADR 0017's bake-off produces an accuracy, latency and real-cost table.

### Required before starting

| # | Requirement | Owner | Status |
| --- | --- | --- | --- |
| 1 | Architecture docs pushed (§0) | You | **Open** |
| 2 | **Failing-recipe examples**: the real recipes where ingredients and steps disagree, preparations were bought, or portions were wrong | You | **Open** (requested in the previous session) |
| 3 | **Where corpus content lives** (see below) | You decide | **Open** |
| 4 | **Bake-off spend budget**, agreed before any paid run (ADR 0017) | You | **Open** |
| 5 | **API key handling** for paid runs: run on the Mac with `ANTHROPIC_API_KEY`, or save it for cloud sessions as an environment network secret. Never committed. | You | Open |
| 6 | Truth-file schema extended for links, portions, preparations, equipment, optional flags, section integrity **and Source attribution** (ADR 0020: cleaned URL, site name, original title, author) | M1 | Ready to design |
| 7 | Scorer that measures each of those separately, not just "did the import succeed" | M1 | Ready to design |
| 8 | Model responses **cached** by fixture, model and effort, so rescoring never spends twice | M1 | Ready to design |

### Where corpus content lives (decision needed)

The repository is **public**. The existing nightmare manifest's own rule is
"URLs only; do not scrape or store recipe content in this fixture". M1 needs
stable source content to score offline: pages change, and step-link truth is
only meaningful against a fixed text. Three options:

- **A. Local, gitignored snapshot cache** (recommended). Commit only URLs, truth
  annotations and content hashes. Each machine fetches and caches page
  snapshots, and the scorer refuses to score if a hash no longer matches.
  Nothing third-party is republished.
- **B. Private storage** (a private repo or bucket) for snapshots, referenced by
  hash.
- **C. Commit snapshots.** Not recommended: it republishes third-party recipes in
  a public repo.

Your own family cards and photos follow the same rule. They are personal, so
keep them out of the public repo (A or B).

### Already in place

- The import harness: `scripts/import-test/`, with estimate, run, compare and
  gate, `baseline.json` and `.truth.json` files.
- 100 nightmare URLs (`tests/fixtures/imports/nightmare-recipes/`).
- The seven domain regression scripts, all green on `main` (see §M3 baseline).

### Safety

- M1 reads the domain modules. It does not change the web app's import
  behaviour.
- Any extractor fix found during M1 waits for M3's package. It is not
  hot-patched into `public/`.
- The bake-off writes reports only. It changes no production configuration
  (`DEFAULT_AI_MODEL` stays as is until a later, approved change).

---

## M3: extract `packages/recipe-core` and prove it on Hermes

**Goal:**

- the eight UMD domain modules become one package;
- the regression scripts run on **Node and Hermes** in CI;
- `apps/web` keeps the same behaviour, verified on a Vercel preview;
- a minimal Expo shell parses one real recipe on a physical iPhone.

### Preconditions (ADR 0003)

**1. Recorded regression baseline.** This is partly done here.

The seven scripts pass on `main` at `7d70c20` (run 2026-11-08, Node 22.23.4,
after `npm ci`):

| Script | Result |
| --- | --- |
| `normalize-test` | ok |
| `import-extract-test` | ok (5 fixtures + helper units) |
| `grounding-test` | ok |
| `recipe-schema-test` | ok |
| `recipe-tags-test` | ok |
| `shopping-list-test` | ok |
| `nutrition-test` | ok (only after `npm ci`, see below) |

Still needed: the **import-harness baseline** from M1. M3's acceptance requires
M1's baseline to reproduce exactly. M1 must therefore reach "baseline committed"
before files move, though the paid bake-off need not be finished.

**2. Documented build and deploy continuity.** This is open. Facts to write down
and verify:

- Vercel builds from the repo root. `vercel.json` routes `/api/*` to
  `api/index.js`, which is `module.exports = require('../server')`, and
  everything else to `public/index.html`.
- `public/app.js` is a **committed build artifact** from `npm run build:app`
  (esbuild 0.20.2, `src/app.jsx` → `public/app.js`). Vercel does not build it.
- `docs/roadmap.md` records production being deployed with `vercel --prod` from
  a named branch. Confirm whether production now follows `main` through Git
  integration or the CLI. A monorepo move has to preserve whichever it is.
- The server's `require` paths into `public/` (for example `RecipeBoxLibrary`)
  must keep resolving after the move, through the package, without changing
  runtime behaviour.
- Verify on a **Vercel preview deployment** of the restructured branch before
  `main` moves: health check, sign-in, library load, one import of each kind.

### Findings that shape the work

- **Not every "pure" test is pure.**
  - `nutrition-test` does `require("../server")`, which loads Express and `pg`.
    It failed with `MODULE_NOT_FOUND` until dependencies were installed. It
    cannot run on Hermes as written.
  - Split it: a pure `nutrition` part, which runs on Node and Hermes, and a
    server-billing part (`detectAiFeature`), which runs on Node only.
- **The tests use Node built-ins.**
  - All seven use `assert`, and `import-extract-test` uses `fs` and `path` to
    read fixtures.
  - On Hermes they need an `assert` shim and fixtures bundled at build time.
    The tests themselves should not be rewritten, so a failure means the same
    thing on both engines.
- **Eight modules, seven scripts.** `recipe-library.js` has no dedicated script.
  It is exercised indirectly by `recipe-save-test` and
  `recipe-persistence-test`, which are server-side.
  - Add a small pure `recipe-library` test so all eight modules are covered on
    Hermes.
- **UMD globals.**
  - Each module ends `module.exports = root.RecipeBoxX = …`. The package exports
    them as real modules.
  - The web build keeps loading them however it does today: either by
    committing built copies to `public/` or by adjusting the esbuild step. This
    is decided and documented as part of precondition 2.
- **No CI exists** (there is no `.github/`). M3 creates it.
  - GitHub Actions jobs: Node regression, Hermes regression,
    `design-tokens-check`, and the web build.
  - The Vercel preview check stays manual until it is automated.

### Decisions or resources needed before starting

| # | Item | Notes |
| --- | --- | --- |
| 1 | §0 docs pushed | Blocker. |
| 2 | M1 harness baseline committed | ADR 0003 precondition 1. |
| 3 | Deploy-continuity doc written and preview verified | ADR 0003 precondition 2. |
| 4 | **Hermes runner** | Run the scripts with a standalone Hermes binary matching the pinned React Native version (fast, CI-friendly), or inside an Expo development build on a device or simulator (closest to production). Recommendation: the standalone binary in CI, and one on-device run per release. |
| 5 | **Expo and React Native versions pinned** | The New Architecture is on. This also fixes the exact `Appearance.setColorScheme` follow-system value (ADR 0019). |
| 6 | **Apple Developer account and a physical iPhone** | A development build through EAS or Xcode, needed for the on-device parse. Expo Go is not enough once native modules are added. An Android device follows the same pattern. |
| 7 | Workspace tool | npm workspaces, which match the existing `package-lock.json`, unless there is a reason to change. |
| 8 | Web round-trip check for unknown recipe fields | Before the native app writes `source` (ADR 0020), prove the web app's edit-and-save path preserves fields it doesn't know. The server already spreads them (`normalizeRecipeForDb`, `validateRecipeForSave`). The client editor path is **unverified**. Do this as a test, not a code change. |

### Design system in M3

- `design/tokens/` moves to `packages/design-tokens` as part of the same
  restructure.
- `design-tokens-check` joins CI.
- No screens are built in M3. The Expo shell is a parsing proof, not the start
  of the UI. Components follow in the client milestones, against
  [the spec](./design/modern-cookbook-spec.md) and
  [the device protocol](./design/accessibility-device-testing.md).

---

## Where M2 stands

M2's acceptance criteria, as defined:

| Criterion | Status |
| --- | --- |
| On-device review of the concepts across five screens at 100/150/200% | Done (you, iPhone) |
| A direction chosen and recorded as an ADR | Done: [ADR 0018](./adr/0018-modern-cookbook-visual-identity.md), with appearance in [ADR 0019](./adr/0019-semantic-tokens-and-appearance.md) |
| All five screens legible at 200% with no horizontal scroll | Done in the prototype, both appearances (automated overflow check, 2026-11-08) |
| Tokens consumable by React Native | Done: `design/tokens/recipebox.tokens.json`, platform-neutral data with a contrast gate |

The real-device accessibility protocol starts with the first native screens.
The prototype cannot satisfy it.

## Suggested order

1. **You:** push the docs (§0) and send the failing-recipe examples.
2. **You:** choose where the corpus content lives (A, B or C) and agree the
   bake-off budget.
3. M1: extend the truth schema (including Source), build the scorer and commit
   the baseline. **Recipe content and costs stay at $0 until step 2 is
   settled.**
4. In parallel: write the deploy-continuity doc and pin the Expo and React
   Native versions.
5. M3: split `nutrition-test`, add the `recipe-library` test, set up CI on Node,
   extract the package, run on Hermes, verify the Vercel preview, then do the
   on-device parse.
6. Paid M1 bake-off, within budget, whenever the corpus is ready. It is
   independent of M3.
