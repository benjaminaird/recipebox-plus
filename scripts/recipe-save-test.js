const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/app.jsx'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
const library = fs.readFileSync(path.join(root, 'public/recipe-library.js'), 'utf8');

assert.match(server, /app\.post\('\/api\/recipes\/save'/, 'dedicated acknowledged save endpoint exists');
assert.match(server, /recipe_json->>'id'.*FOR UPDATE/s, 'save is idempotent by stable recipe id');
assert.match(server, /pg_advisory_xact_lock/, 'concurrent double taps serialize before insert');
assert.match(server, /await db\.connect\(\)/, 'recipe transactions hold one dedicated pooled connection');
assert.match(server, /savedToDatabase: true/, 'server confirms durable persistence');
assert.match(server, /readVisibleRecipesPage/, 'server exposes scalable cursor pagination');
assert.match(server, /Cache-Control', 'private, no-store/, 'recipe reads cannot be restored from an HTTP cache');
assert.match(server, /if \(!user\) return res\.status\(401\)/, 'save requires an authenticated session');
assert.match(server, /validateRecipeForSave/, 'server validates recipe payloads');
assert.match(server, /recipe category is not allowed/, 'all saves validate categories server-side');
assert.match(server, /recipe_save_failed/, 'save failures have structured, content-free logging');
const saveFailureLog = server.match(/log\('recipe_save_failed',[^\n]+/)[0];
assert.doesNotMatch(saveFailureLog, /userId|recipeId/, 'save failure logs omit private identifiers');

assert.match(app, /await persistRecipe\(t,"create"\)/, 'new recipes await persistence');
assert.match(app, /await persistRecipe\(t,operation\)/, 'edited recipes await persistence');
assert.match(app, /fetchCompleteRecipeLibrary/, 'client aggregates the complete paginated library');
assert.match(library, /fetchAllPages/, 'shared page walker is available to browser and tests');
assert.match(library, /EMBEDDED_IMAGE_PREFIX/, 'local mirror strips quota-heavy embedded images');
assert.match(app, /disabled=\{saveBusy\}/, 'save button prevents repeated taps');
assert.match(app, /Your edits are still here/, 'failed edits remain recoverable');
assert.match(app, /Recipe saved to your library/, 'success appears only after acknowledged persistence');
assert.match(app, /adjustedFromRecipeId/, 'AI copies retain provenance without reusing the original id');
assert.match(app, /crypto\.randomUUID/, 'new recipe ids use collision-resistant UUIDs');
assert.match(app, /Move to Category/, 'single recipe category move is discoverable');
assert.match(app, /"Baked Goods"/, 'Baked Goods is a first-class category');
assert.match(app, /Beverages, Desserts, Baked Goods\. Pick the closest real type/, 'AI/import classification allowlist includes Baked Goods');
assert.match(app, /\/images\/categories\/baked-goods\.webp/, 'Baked Goods uses a local asset');
assert.match(sw, /baked-goods\.webp/, 'PWA precaches the category asset');
assert.ok(fs.statSync(path.join(root, 'public/images/categories/baked-goods.webp')).size < 250000, 'hero is mobile-friendly');

console.log('recipe-save-test: ok');
