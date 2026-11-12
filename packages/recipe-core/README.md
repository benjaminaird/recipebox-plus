# @recipebox/recipe-core

RecipeBox's portable domain logic, and the reason the native client is React
Native rather than a rewrite ([ADR 0003](../../docs/adr/0003-monorepo-with-shared-domain-package.md)).

Eight modules, each pure UMD JavaScript: a string or an object goes in, a value
comes out. **No DOM, no network, no AI call, no dependencies** — not as a style
preference but as the contract that lets the same code run in a browser, in
Node, and inside Hermes on a phone.

| Module | What it owns |
|---|---|
| `recipe-extract` | Deterministic extraction from a page's JSON-LD and microdata |
| `recipe-normalize` | Deterministic formatting: abbreviations, fractions, typos. Never quantities |
| `recipe-grounding` | Whether an AI extraction is actually supported by its source |
| `recipe-schema` | The typed tool definitions for constrained AI extraction |
| `recipe-tags` | Tag canonicalization and smart collections |
| `recipe-library` | Category canonicalization, local mirroring, page walking |
| `shopping-list` | Ingredient parsing, aggregation, aisle grouping |
| `nutrition` | Macro normalization, fingerprinting, the estimate prompt |

## Who consumes it

Four surfaces, by **plain relative path** in every case:

- **The web app** — `public/index.html` loads the generated copies in `public/`
  as `<script src>` tags, which attach `window.RecipeBoxShopping` and the rest.
- **The Express backend** — `server.js` requires three of them directly.
- **The regression scripts** — `scripts/*.js` require them with no `npm install`
  at all. CI runs that job without one, on purpose; it is how the
  dependency-free contract is enforced rather than merely asserted.
- **The native app** — `apps/mobile/src/domain/web*.ts` import them, reached
  through Metro's `watchFolders`. Those wrappers are the only place the native
  client touches this package, so its surface stays visible.

Nothing resolves `@recipebox/recipe-core` through `node_modules`. The package
name and `exports` map declare the module's identity and its CommonJS-ness; they
are not a resolution path, and must not become a load-bearing one while the CI
domain job runs without installing anything.

## `public/` holds generated copies

Vercel serves `public/` as the static root, and nothing builds on deploy. So the
browser's copies are committed artifacts, exactly like `public/app.js`:

```
npm run build:core     # copy src/*.js -> public/
npm run core:check     # fail if the two have drifted
```

`core:check` runs in CI. Editing `public/shopping-list.js` by hand fails the
build, and the banner at the top of each file here says so.

## Changing anything in here

Every module is load-bearing for real users' saved recipes. Each has a
regression script, and they are the product's core promise rather than a test
suite to keep green for its own sake:

```
npm run normalize-test        npm run recipe-tags-test
npm run import-extract-test   npm run shopping-list-test
npm run grounding-test        npm run nutrition-test
npm run recipe-schema-test    npm run recipe-library-test
```

A change that alters the web app's observable behaviour needs a decision behind
it, not just a green suite — see the metric-unit gaps recorded in
[docs/native-overnight-progress.md](../../docs/native-overnight-progress.md).
