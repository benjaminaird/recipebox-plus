const assert = require('assert');

const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const email = process.env.SMOKE_EMAIL || `recipebox-smoke-${Date.now()}@example.com`;
const password = process.env.SMOKE_PASSWORD || 'temporary-password';

let cookie = '';

function captureCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return;
  const session = setCookie.split(',').map((part) => part.trim()).find((part) => part.startsWith('rb_session='));
  if (session) cookie = session.split(';')[0];
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(baseUrl + path, { ...options, headers });
  captureCookie(res);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data && data.error ? data.error : `${res.status} ${res.statusText}`;
    throw new Error(`${options.method || 'GET'} ${path} failed: ${message}`);
  }
  return data;
}

async function main() {
  console.log(`Smoke testing ${baseUrl}`);

  const health = await request('/api/health');
  assert.strictEqual(health.status, 'ok');

  const resetRes = await fetch(baseUrl + '/api/auth/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `missing-${Date.now()}@example.com` }),
  });
  assert.ok(resetRes.ok || resetRes.status === 503, 'password reset route should respond predictably');

  if (!health.database) {
    console.log('Smoke test passed in no-database mode; account sync checks skipped.');
    return;
  }

  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      email,
      displayName: 'RecipeBox Smoke',
      password,
      recipes: [],
      mealPlan: {},
    }),
  });
  assert.strictEqual(signup.ok, true);
  assert.strictEqual(signup.user.email, email);

  const recipe = {
    id: `smoke-${Date.now()}`,
    title: 'Smoke Test Recipe',
    category: 'Entrées',
    cookTime: '10 min',
    servings: 2,
    description: 'Temporary smoke test recipe.',
    heroImage: '',
    favorite: false,
    rating: 0,
    tags: ['smoke'],
    macros: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
    sections: [{
      name: 'Main',
      ingredients: [{ id: 'i1', amount: '1', unit: 'cup', name: 'test ingredient' }],
      steps: [{ id: 's1', text: 'Stir for 1 minute.', ingredientRefs: [] }],
    }],
    createdAt: new Date().toISOString(),
  };
  await request('/api/recipes', {
    method: 'PUT',
    body: JSON.stringify({ recipes: [recipe] }),
  });
  const recipes = await request('/api/recipes');
  assert.strictEqual(Array.isArray(recipes), true);
  assert.strictEqual(recipes.length, 1);
  assert.strictEqual(recipes[0].title, recipe.title);

  const mealPlan = { Monday: [recipe.id], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] };
  await request('/api/mealplan', {
    method: 'PUT',
    body: JSON.stringify({ mealPlan }),
  });
  const savedMealPlan = await request('/api/mealplan');
  assert.deepStrictEqual(savedMealPlan.Monday, [recipe.id]);

  const session = await request('/api/auth/session');
  assert.strictEqual(session.user.email, email);

  await request('/api/auth/signout', { method: 'POST', body: JSON.stringify({}) });
  cookie = '';

  await request('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  await request('/api/auth/delete-account', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });

  console.log('Smoke test passed');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
