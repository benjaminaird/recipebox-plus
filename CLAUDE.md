# RecipeBox — working notes for Claude

Read [GLOSSARY.md](./GLOSSARY.md) for the project's vocabulary and
[docs/adr/](./docs/adr/) for decisions already made.

## The one thing not to get wrong

**RecipeBox's mobile app is genuinely native, not a wrapped web app.** See
[ADR 0001](./docs/adr/0001-native-mobile-client.md). Do not propose, plan or
build a Capacitor/WebView shell, an embedding of the existing React web UI, or a
responsive restyle of the web app presented as the native product. These were
considered and rejected deliberately. If you think one of them is the right
answer, say so and ask — do not quietly reintroduce it.

The `native/everplate` Capacitor shell is historical and carries a rejected
brand name. It is not the direction.

Web prototypes built to explore the visual identity are **disposable design
experiments**, not the foundation of the mobile app. Do not let one graduate
into the product.

## Naming

The product is **RecipeBox**. "RecipeBox 2.0" and "RecipeBox Plus" are obsolete
names — do not use them in anything a user sees. The repository
(`recipebox-plus`) and the branch (`feature/recipebox-2.0`) deliberately keep
their names; do not rename them. ADRs 0001–0012 predate this and still say
"RecipeBox 2.0"; read that as "the native RecipeBox client".

## Decisions already made

- [0001](./docs/adr/0001-native-mobile-client.md) — native client, not a web wrapper
- [0002](./docs/adr/0002-react-native-expo.md) — React Native + Expo
- [0003](./docs/adr/0003-monorepo-with-shared-domain-package.md) — one repo, shared domain package
- [0004](./docs/adr/0004-local-first-with-sqlite.md) — local-first SQLite; includes which imports can work offline
- [0005](./docs/adr/0005-web-app-becomes-a-secondary-surface.md) — the web app stays live as a secondary surface
- [0006](./docs/adr/0006-synchronisation-and-conflict-policy.md) — revisions, conflict rules, tombstones, offline auth
- [0007](./docs/adr/0007-deterministic-first-pasted-text.md) — pasted text parses on-device first
- [0008](./docs/adr/0008-original-source-media-in-object-storage.md) — media to object storage; existing originals are already compressed
- [0009](./docs/adr/0009-portable-library-export-format.md) — versioned export is the backup mechanism
- [0010](./docs/adr/0010-versioned-api-and-token-auth.md) — /api/v1 + token auth for native; web cookies untouched
- [0011](./docs/adr/0011-native-v1-scope-and-build-order.md) — v1 scope; household retained; sync built in four stages
- [0012](./docs/adr/0012-structured-recipe-model.md) — one ingredient list, steps reference it; blocks Recipe Detail and Cook Mode
- [0013](./docs/adr/0013-the-product-is-called-recipebox.md) — the product is **RecipeBox**; "2.0" and "Plus" are obsolete, but the branch and repo keep their names
- [0014](./docs/adr/0014-contextual-import-review.md) — review in context; an unresolved recipe can still be saved
- [0015](./docs/adr/0015-recipe-version-history.md) — originals kept, every change reversible
- [0016](./docs/adr/0016-ai-recipe-helper.md) — the Helper proposes, validates, and waits for approval
- [0017](./docs/adr/0017-model-selection-is-measured.md) — the production model is chosen by measurement
- [0018](./docs/adr/0018-modern-cookbook-visual-identity.md) — the Modern Cookbook visual direction
- [0019](./docs/adr/0019-semantic-tokens-and-appearance.md) — one semantic token set, System / Light / Dark from the first build
- [0020](./docs/adr/0020-recipe-source-attribution.md) — Source attribution is structured, durable and always visible
- [0021](./docs/adr/0021-metric-and-us-customary-are-separate.md) — metric and US customary are separate systems; a shopping list never mixes them

## Product requirements

- [docs/product-requirements.md](./docs/product-requirements.md) — the product experience, with confirmed / existing / unresolved / future clearly separated
- [docs/recipe-model-investigation.md](./docs/recipe-model-investigation.md) — the recipe-model milestone that gates Recipe Detail and Cook Mode

## What is what

- `server.js` — the Express backend (monolith, ~3,900 lines, 58 routes).
- `src/app.jsx` — the **web** front end (monolith, ~6,800 lines). Edit this, then
  run `npm run build:app`. Never hand-edit `public/app.js`; it is a build
  artifact.
- `packages/recipe-core/src/*.js` — the portable domain logic: pure UMD
  JavaScript, no DOM, no network, no dependencies. This is the most valuable
  code in the repo and the reason the native client is React Native. It is a
  shared library, not web code, and it is the **only** editable copy. See
  [packages/recipe-core/README.md](./packages/recipe-core/README.md).
- `public/shopping-list.js`, `public/recipe-*.js`, `public/nutrition.js` —
  generated copies of the above, served to the browser as `<script src>` tags
  because Vercel serves `public/` as the static root and nothing builds on
  deploy. Never hand-edit them: change the package and run `npm run build:core`.
  `npm run core:check` fails the build if the two have drifted.

## Rules

- The production web app stays operational and unchanged in behaviour until a
  replacement is explicitly approved.
- Never delete, overwrite or invalidate saved recipe data. The localStorage keys
  (`recipebox-v5`, `recipebox-mealplan-v2`, `recipebox-shopping-v1`,
  `recipebox-pantry-v1`) and the Neon schema are load-bearing for real users.
- Import reliability is the product's core promise. Any change touching
  `packages/recipe-core` must keep its regression scripts green: `normalize-test`,
  `import-extract-test`, `grounding-test`, `recipe-schema-test`,
  `recipe-tags-test`, `shopping-list-test`, `nutrition-test`,
  `recipe-library-test`. CI runs them with no `npm install` at all, which is how
  the package's dependency-free contract is enforced rather than merely stated.
- `docs/roadmap.md` is a historical log and is partly stale — it still names a
  production branch that is now behind `main`. Trust the code and the ADRs over
  the roadmap.
