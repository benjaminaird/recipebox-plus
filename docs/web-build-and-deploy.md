# How the web app builds and deploys

Verified 2026-11-08 by reading the repository and the Vercel project's settings
and deployment history (read-only), and by building and running the app
locally. This is precondition 2 of ADR 0003. Any restructuring (M3) must keep
every statement here true, or update it in the same change.

## Production

| Item | Fact |
| --- | --- |
| Host | Vercel project `recipebox` (`prj_4X6etc2Us1zjzg872ZNgyJt92cxj`), team `benjamin-aird-s-projects` |
| Production URL | `https://recipebox-kappa.vercel.app` |
| Production source | **Git integration on `main`.** The current production deployment is `main` at `7d70c20` (target `production`, created by the GitHub integration). |
| Framework preset | None (`framework: null`) |
| Node.js | `24.x` (project setting). `package.json` declares no `engines`. |
| Deployment protection | Vercel SSO on all deployments except custom domains, so preview URLs require a Vercel login |

`docs/roadmap.md` still says production is deployed by `vercel --prod` from a
named branch. **That is stale.** Production follows `main`.

## Previews

**Every push to any branch creates a Vercel Preview deployment automatically.**
This branch's own pushes created previews at `8cd9363`, `ce1f471`, `7c6ad2b`
and `d174b63`. Previews are SSO-protected and not indexed.

**Open question, needs you:** this session cannot read the project's
environment variables (Vercel returned 403). If `DATABASE_URL`,
`ANTHROPIC_API_KEY` or `RESEND_API_KEY` are set for the **Preview** environment
with production values, then signing in or saving on any preview reads and
writes **production data** and spends real AI credits. Until that's confirmed,
**do not use preview deployments to test anything that writes**. Use the local
isolated check below. To make previews safe: Vercel → Project → Settings →
Environment Variables → give Preview its own Neon branch database (or none),
and no production API keys.

## What gets deployed

`vercel.json` has no build command. Vercel uploads the repository and:

1. Builds **one serverless function**, `api/index.js`, whose entire content is
   `module.exports = require('../server')`. `maxDuration` is 60 seconds. The
   function bundle includes `server.js` and everything it `require`s, including
   the UMD domain modules in `public/` (`recipe-library.js` and friends), plus
   `node_modules`.
2. Serves the **static files in `public/`**: `index.html`, `app.js`, the domain
   modules, icons and manifest.
3. Applies `vercel.json`:
   - **rewrites** send `/api/*` to `/api/index.js` and every other path to
     `/index.html` (single-page app);
   - **headers** add security headers on every route (CSP in report-only mode)
     and `no-cache` on HTML, `app.js`, `sw.js` and three domain modules.

`npm install` runs from the committed `package-lock.json`.

## The front-end bundle is a committed artifact

- `public/app.js` is produced by `npm run build:app`, which runs
  `npx esbuild@0.20.2 src/app.jsx --jsx=transform --minify --target=es2020 --legal-comments=none --outfile=public/app.js`.
- **Vercel does not run it.** The committed `public/app.js` is what ships. A
  change to `src/app.jsx` without a rebuilt, committed `app.js` does not reach
  users.
- Verified: building `src/app.jsx` at `7d70c20` reproduces the committed
  `public/app.js` **byte for byte**. CI now checks this on every push.
- `index.html` loads React 18, React DOM, jsPDF, pdf.js and heic2any from public
  CDNs (unpkg, cdnjs, jsDelivr). Then it loads the domain modules as globals
  (`window.RecipeBoxExtract` and others), then `/app.js`.

## Server modes

- `server.js` runs standalone (`node server.js`, port `PORT` or 3000) and
  serves `public/` with `express.static`.
- **Without `DATABASE_URL`** it runs in **no-database mode**: `/api/health`
  reports `{"status":"ok","database":false}`, account sync is skipped, and
  nothing persists server-side.
- AI, email and YouTube features are inert without their keys.

## Isolated verification (no production contact)

```sh
node scripts/web-preview-check.js
```

The script:

1. starts `server.js` locally with a **scrubbed environment**: no database, no
   AI, email or API keys;
2. **refuses to continue** if the server reports a database;
3. runs the existing `smoke-test` and `security-smoke-test` against it;
4. when Playwright is installed, loads the app in a phone-sized headless
   browser and checks that it renders with no page errors;
5. fails if any tracked file changed during the run.

Result on 2026-11-08 at this branch's tip (production code identical to `main`):

| Check | Result |
| --- | --- |
| Health | no database, no credentials |
| `smoke-test` | passed (no-database mode; account sync checks skipped) |
| `security-smoke-test` | 5/5 checks passed |
| Browser | title "RecipeBox"; the sign-in screen rendered; no page errors |

In sandboxes without CDN access, set `WEB_CHECK_CDN_DIR` to a `node_modules`
folder containing the exact library versions `index.html` requests, and the
check serves them locally. CI uses the real CDNs.

## Tests that must not run in CI as they stand

- **`nightmare-import-test`** fetches 100 third-party sites and **rewrites
  tracked files** under `tests/results/`. Run it deliberately, never in CI.
- **`preview-save-verification`** takes a deployed URL and saves recipes there.
  Pointed at a preview that shares production's database, it writes production
  data. Run it only against a preview confirmed to have its own database.
- **`smoke-test`** and **`security-smoke-test`** need a running server. CI runs
  them only through `web-preview-check.js`, against the isolated local server.

## What M3 must preserve

- `api/index.js` keeps exporting the Express app from the same `server.js`
  behaviour.
- `server.js` keeps resolving the domain modules. Today that is
  `require('./public/recipe-extract')`, `./public/shopping-list` and
  `./public/recipe-library`. After extraction it resolves
  through the package, with an identical runtime result.
- `public/` keeps serving the same files at the same paths, including the
  domain modules as browser globals.
- `public/app.js` stays a reproducible build of `src/app.jsx`, which CI checks.
- `vercel.json` rewrites and headers stay unchanged, and production stays on
  `main` through Git integration.
- Verification before `main` moves: `web-preview-check.js` green, plus a manual
  check of a Vercel preview, **only after** Preview has been confirmed to use a
  non-production database.
