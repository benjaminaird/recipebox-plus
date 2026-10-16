# RecipeBox — working notes for Claude

Read [GLOSSARY.md](./GLOSSARY.md) for the project's vocabulary and
[docs/adr/](./docs/adr/) for decisions already made.

## The one thing not to get wrong

**RecipeBox 2.0 is a genuinely native mobile app, not a wrapped web app.** See
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

## Decisions already made

- [0001](./docs/adr/0001-native-mobile-client.md) — native client, not a web wrapper
- [0002](./docs/adr/0002-react-native-expo.md) — React Native + Expo
- [0003](./docs/adr/0003-monorepo-with-shared-domain-package.md) — one repo, shared domain package
- [0004](./docs/adr/0004-local-first-with-sqlite.md) — local-first SQLite; includes which imports can work offline
- [0005](./docs/adr/0005-web-app-becomes-a-secondary-surface.md) — the web app stays live as a secondary surface
- [0006](./docs/adr/0006-synchronisation-and-conflict-policy.md) — revisions, conflict rules, tombstones, offline auth
- [0007](./docs/adr/0007-deterministic-first-pasted-text.md) — pasted text parses on-device first

## What is what

- `server.js` — the Express backend (monolith, ~3,900 lines, 58 routes).
- `src/app.jsx` — the **web** front end (monolith, ~6,800 lines). Edit this, then
  run `npm run build:app`. Never hand-edit `public/app.js`; it is a build
  artifact.
- `public/recipe-*.js`, `public/shopping-list.js`, `public/nutrition.js` — the
  portable domain logic: pure UMD JavaScript, no DOM, no network, no
  dependencies. This is the most valuable code in the repo and the reason the
  native client is React Native. Treat it as a shared library, not web code.

## Rules

- The production web app stays operational and unchanged in behaviour until a
  replacement is explicitly approved.
- Never delete, overwrite or invalidate saved recipe data. The localStorage keys
  (`recipebox-v5`, `recipebox-mealplan-v2`, `recipebox-shopping-v1`,
  `recipebox-pantry-v1`) and the Neon schema are load-bearing for real users.
- Import reliability is the product's core promise. Any change touching the
  domain modules must keep their regression scripts green: `normalize-test`,
  `import-extract-test`, `grounding-test`, `recipe-schema-test`,
  `recipe-tags-test`, `shopping-list-test`, `nutrition-test`.
- `docs/roadmap.md` is a historical log and is partly stale — it still names a
  production branch that is now behind `main`. Trust the code and the ADRs over
  the roadmap.
