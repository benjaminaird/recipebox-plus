const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = require('../server');
const Library = require('../public/recipe-library');

const {
  validateRecipeForSave,
  upsertUserRecipe,
  readVisibleRecipesPage,
  parseRecipePageLimit,
  canonicalRecipeCategory,
  RECIPE_CATEGORIES,
} = app._test;

function rowUuid(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}

function recipe(number, category = 'Entrées') {
  return {
    id:`recipe-${String(number).padStart(2, '0')}`,
    title:`Recipe ${String(number).padStart(2, '0')}`,
    category,
    createdAt:new Date(Date.UTC(2026, 6, 1, 0, number)).toISOString(),
    heroImage:`data:image/jpeg;base64,${'A'.repeat(10000)}`,
    sections:[{ name:'Main', ingredients:[{ amount:'1', unit:'cup', name:'flour' }], steps:[{ text:'Mix and cook.' }] }],
  };
}

class MemoryRecipeDb {
  constructor() {
    this.rows = [];
    this.lockCalls = 0;
    this.releaseCalls = 0;
    this.failRecipeId = null;
  }

  async connect() {
    return { query:this.query.bind(this), release:() => { this.releaseCalls++; } };
  }

  async query(sql, params = []) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows:[] };
    if (sql.includes('pg_advisory_xact_lock')) { this.lockCalls++; return { rows:[] }; }
    if (sql.includes("SELECT id FROM recipes WHERE user_id=$1 AND recipe_json->>'id'=$2")) {
      const found = this.rows.find((row) => row.user_id === params[0] && row.recipe_json.id === params[1]);
      return { rows:found ? [{ id:found.row_id }] : [] };
    }
    if (sql.includes('UPDATE recipes SET title=')) {
      const row = this.rows.find((item) => item.row_id === params[0] && item.user_id === params[1]);
      if (!row) return { rows:[] };
      row.title = params[2]; row.category = params[3]; row.recipe_json = JSON.parse(params[5]);
      return { rows:[] };
    }
    if (sql.includes('INSERT INTO recipes')) {
      const parsed = JSON.parse(params[4]);
      if (parsed.id === this.failRecipeId) throw new Error('simulated database failure');
      this.rows.push({
        row_id:rowUuid(this.rows.length + 1), user_id:params[0], title:params[1], category:params[2],
        recipe_json:parsed, display_name:'Owner',
        created_at:new Date(Date.UTC(2026, 6, 1, 1, this.rows.length)),
      });
      return { rows:[] };
    }
    if (sql.includes('FROM recipes r') && sql.includes('ORDER BY r.created_at DESC, r.id DESC')) {
      const userId = params[0];
      const limitPlusOne = params[params.length - 1];
      let rows = this.rows.filter((row) => row.user_id === userId);
      rows.sort((a, b) => b.created_at - a.created_at || b.row_id.localeCompare(a.row_id));
      if (params.length === 4) {
        const cursorTime = new Date(params[1]).getTime();
        const cursorId = params[2];
        rows = rows.filter((row) => row.created_at.getTime() < cursorTime || (row.created_at.getTime() === cursorTime && row.row_id < cursorId));
      }
      return { rows:rows.slice(0, limitPlusOne) };
    }
    throw new Error(`Unexpected SQL in test: ${sql.slice(0, 80)}`);
  }
}

(async () => {
  const db = new MemoryRecipeDb();
  const userId = 'test-user';
  const recipes = Array.from({ length:25 }, (_, index) => recipe(index + 1, index === 16 ? 'Baked Goods' : 'Entrées'));

  // More than ten rapid saves persist independently; retrying an id updates it
  // rather than appending a duplicate.
  await Promise.all(recipes.map((item) => upsertUserRecipe(userId, item, db)));
  assert.strictEqual(db.rows.length, 25, '25 successive/concurrent saves survive');
  const edited = { ...recipes[12], title:'Recipe 13 edited' };
  await upsertUserRecipe(userId, edited, db);
  assert.strictEqual(db.rows.length, 25, 'idempotent retry does not duplicate');
  assert.strictEqual(db.rows.find((row) => row.recipe_json.id === edited.id).recipe_json.title, edited.title, 'edit persists');
  assert.strictEqual(db.lockCalls, 26, 'every mutation takes the per-user transaction lock');
  assert.strictEqual(db.releaseCalls, 26, 'every mutation holds and releases one dedicated database connection');

  // The real server page builder and real client aggregator restore all records.
  const cursors = [];
  const restored = await Library.fetchAllPages(async (cursor) => {
    cursors.push(cursor);
    return readVisibleRecipesPage(userId, { db, limit:7, cursor });
  });
  assert.strictEqual(cursors.length, 4, '25 recipes require four pages at page size seven');
  assert.strictEqual(restored.length, 25, 'restart hydration restores more than ten recipes');
  assert.strictEqual(new Set(restored.map((item) => item.id)).size, 25, 'pagination has no duplicates or omissions');
  assert.ok(restored.some((item) => item.id === 'recipe-25'), 'recent import survives rehydration');

  // Local restart data remains complete without multi-megabyte embedded photos.
  const localMirror = Library.compactRecipesForLocal(restored);
  const restartedLocal = JSON.parse(JSON.stringify(localMirror));
  assert.strictEqual(restartedLocal.length, 25, 'offline mirror keeps every recipe');
  assert.ok(restartedLocal.every((item) => item.heroImage === ''), 'embedded image blobs do not exhaust localStorage');
  assert.ok(JSON.stringify(restartedLocal).length < 100000, 'text mirror stays well below mobile localStorage pressure');

  // A partial page failure rejects the whole refresh, allowing the caller to
  // keep its previous state instead of replacing it with an incomplete prefix.
  const beforeFailedRefresh = restartedLocal;
  let calls = 0;
  await assert.rejects(Library.fetchAllPages(async () => {
    calls++;
    if (calls === 2) throw new Error('network interrupted');
    return { recipes:restored.slice(0, 7), nextCursor:'second-page' };
  }), /network interrupted/);
  assert.strictEqual(beforeFailedRefresh.length, 25, 'failed hydration leaves the existing library intact');

  // A failed database write rejects; success cannot be inferred from optimistic state.
  db.failRecipeId = 'recipe-99';
  await assert.rejects(upsertUserRecipe(userId, recipe(99), db), /simulated database failure/);
  assert.strictEqual(db.rows.length, 25, 'failed persistence adds no record');
  assert.strictEqual(db.releaseCalls, 27, 'failed persistence also releases its database connection');

  // Canonical category compatibility, including bakery, survives save + reload.
  for (const category of RECIPE_CATEGORIES) assert.doesNotThrow(() => validateRecipeForSave(recipe(80, category)));
  const baked = restored.find((item) => item.category === 'Baked Goods');
  assert.ok(baked, 'Baked Goods is accepted and survives reload');
  assert.strictEqual(canonicalRecipeCategory('Bakery'), 'Baked Goods', 'legacy Bakery records normalize to the canonical category');
  assert.strictEqual(validateRecipeForSave(recipe(81, 'Bakery')).category, 'Baked Goods', 'legacy category saves remain compatible');
  assert.strictEqual(Library.canonicalizeRecipe(recipe(82, 'Baking')).category, 'Baked Goods', 'offline legacy records remain discoverable');
  assert.strictEqual(parseRecipePageLimit(undefined), 50);
  assert.throws(() => parseRecipePageLimit('0'), /between 1 and 100/);

  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'src/app.jsx'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  assert.ok(source.indexOf('await persistRecipe(t,"create")') < source.indexOf('setRecipes((p) => p.some'), 'UI updates only after acknowledged create');
  assert.match(source, /fetchCompleteRecipeLibrary\(\).*\.then\(\(cloudRecipes\)/s, 'startup uses complete paginated hydration');
  assert.match(source, /failed or interrupted refresh leaves the existing local library intact/i, 'startup documents non-destructive failure behavior');
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)\) return/, 'service worker never caches recipe API responses');

  console.log('recipe-persistence-test: ok (25 saves, 4 pages, restart, failure, bakery)');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
