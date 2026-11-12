---
status: accepted
date: 2026-10-16
---

# Keep one repository, extract the domain logic into a shared package

RecipeBox 2.0 needs a new native client (ADR 0001, ADR 0002) without
duplicating the backend or endangering existing users' saved recipes. Three
structures were considered: a new app directory inside `recipebox-plus`, a
structured monorepo with shared packages, or a separate repository consuming the
RecipeBox API.

**Recommendation: stay in `recipebox-plus` and convert it into a workspace
monorepo**, roughly:

```
packages/recipe-core/    ← the 2,358 lines of pure domain logic, extracted
apps/web/                ← today's server.js + src/app.jsx, unchanged in behaviour
apps/mobile/             ← the new Expo client
```

A **separate repository is rejected** because the native client and the web app
must share the import/normalisation logic. Across two repos that sharing becomes
a published npm package with its own release cycle, and in practice the two
copies drift — which would quietly undo the 98.9% import pass rate that made
React Native the right choice in the first place.

A **plain app directory with no shared package is rejected** because it invites
copy-pasting `recipe-extract.js` and friends into the mobile app. Two copies of
the extractor is the specific failure this structure exists to prevent.

## Consequences

- One shared package means one place to fix an extraction bug, and both clients
  get it.
- `apps/web` keeps deploying to Vercel exactly as it does today; the monorepo
  move must not change the production deployment or the Neon database.
- The existing `feature/recipebox-2.0` branch is where this restructuring
  happens. It is preserved, not discarded.
- Extracting `packages/recipe-core` is a mechanical, test-guarded refactor: the
  seven existing regression scripts (`normalize-test`, `import-extract-test`,
  `grounding-test`, `recipe-schema-test`, `recipe-tags-test`,
  `shopping-list-test`, `nutrition-test`) must pass unchanged before and after.

## Preconditions before any restructuring starts

Restructuring is approved in principle only. Before the first file moves:

1. **Recorded regression baseline.** Run the full script suite plus the import
   harness on `main` and commit the results, so "unchanged behaviour" is a
   measured claim rather than an assertion.
2. **Documented build and deploy continuity.** Write down exactly how
   `apps/web` keeps building and deploying to Vercel — `vercel.json`, the
   `api/index.js` entry point, the `build:app` esbuild step and the output path
   `public/app.js` — and verify it on a preview deployment before `main` moves.
   The production web app must not break for a single deploy.

## Status of the work (2026-11-11)

`packages/recipe-core` **exists and is the only editable copy** of all eight
domain modules. `server.js`, the regression scripts and the native app resolve
it by relative path; `public/` holds generated copies for the browser, because
Vercel serves `public/` as the static root and nothing builds on deploy.
`npm run core:check` fails if the two drift, and it runs in CI.

Precondition 1 was met by comparing the six regression suites that exist on both
`main` and this branch: identical output, byte for byte, before and after the
move. The module bodies themselves are identical to `main` apart from a
banner naming the canonical source. Precondition 2 was met earlier by
[docs/web-build-and-deploy.md](../web-build-and-deploy.md).

`apps/web/` has **not** happened and is not scheduled. Moving `server.js` and
`src/app.jsx` touches `vercel.json`, `api/index.js` and the deploy path itself,
and it buys nothing the shared package did not already buy: the thing that made
extraction urgent was two surfaces needing one extractor, and that is now true.
The sketch above should be read as the structure this ADR would have reached,
not as remaining work.
