#!/usr/bin/env node
/*
 * Destructive only to two uniquely named disposable accounts created by this
 * run. Exercises the deployed preview through `vercel curl` and always attempts
 * account cleanup. No credentials or recipe contents are printed.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const deployment = process.argv[2];
if (!deployment || !/^https:\/\/[a-z0-9.-]+\.vercel\.app$/i.test(deployment)) {
  console.error('Usage: node scripts/preview-save-verification.js https://PREVIEW.vercel.app');
  process.exit(2);
}

const runId = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipebox-preview-'));
const users = [0, 1].map((n) => ({
  email: `recipebox-preview-${runId}-${n}@example.invalid`,
  password: crypto.randomBytes(24).toString('base64url'),
  cookie: path.join(tempDir, `user-${n}.cookies`),
}));

function request(user, route, method = 'GET', body) {
  const forwarded = ['--silent', '--show-error', '--cookie', user.cookie, '--cookie-jar', user.cookie, '-X', method];
  if (body !== undefined) forwarded.push('-H', 'Content-Type: application/json', '--data-raw', JSON.stringify(body));
  const result = spawnSync('npx', ['--yes', 'vercel@latest', 'curl', route, '--deployment', deployment, '--', ...forwarded], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`preview request failed for ${route}`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`preview returned a non-JSON response for ${route}`); }
}

function recipe(id, title, category = 'Entrées') {
  return {
    id, title, description:'Preview persistence verification', servings:6,
    prepTime:'15 minutes', cookTime:'35 minutes', totalTime:'50 minutes',
    category, tags:['Preview Verification','Weeknight'], notes:'Disposable verification record.',
    heroImage:'', sourceUrl:'https://example.invalid/verification', favorite:false, rating:0,
    createdAt:new Date().toISOString(), measurementPreference:'us',
    sections:[{ name:'Main', ingredients:[
      {id:crypto.randomUUID(),amount:'2',unit:'cups',name:'flour'},
      {id:crypto.randomUUID(),amount:'1',unit:'tbsp',name:'olive oil'},
    ], steps:[
      {id:crypto.randomUUID(),text:'Combine the ingredients thoroughly.',ingredientRefs:[]},
      {id:crypto.randomUUID(),text:'Cook until the verification timer finishes.',ingredientRefs:[]},
    ]}],
  };
}

const originalId = crypto.randomUUID();
const aiCopyId = crypto.randomUUID();
const aiSecondId = crypto.randomUUID();
let created = 0;
const checks = [];

try {
  for (const [index, user] of users.entries()) {
    const signup = request(user, '/api/auth/signup', 'POST', { email:user.email, displayName:`Preview User ${index + 1}`, password:user.password, recipes:[], mealPlan:{} });
    assert.strictEqual(signup.ok, true); created++;
  }
  checks.push('two authenticated sessions');

  const manual = recipe(originalId, 'Preview Manual Recipe');
  const create = request(users[0], '/api/recipes/save', 'POST', { recipe:manual, operation:'create' });
  assert.strictEqual(create.savedToDatabase, true);
  assert.ok(create.requestId);
  checks.push('manual create confirmed');

  const retry = request(users[0], '/api/recipes/save', 'POST', { recipe:manual, operation:'create' });
  assert.strictEqual(retry.savedToDatabase, true);
  let aLibrary = request(users[0], '/api/recipes');
  assert.strictEqual(aLibrary.filter((r) => r.id === originalId).length, 1);
  checks.push('same-id retry is idempotent');

  const edited = { ...manual, title:'Preview Manual Recipe Edited', sections:[{...manual.sections[0],ingredients:[...manual.sections[0].ingredients,{id:crypto.randomUUID(),amount:'1',unit:'tsp',name:'salt'}]}] };
  request(users[0], '/api/recipes/save', 'POST', { recipe:edited, operation:'update' });
  aLibrary = request(users[0], '/api/recipes');
  assert.strictEqual(aLibrary.filter((r) => r.id === originalId).length, 1);
  assert.strictEqual(aLibrary.find((r) => r.id === originalId).title, edited.title);
  assert.strictEqual(aLibrary.find((r) => r.id === originalId).sections[0].ingredients.length, 3);
  checks.push('existing recipe updates without duplication');

  const aiCopy = { ...edited, id:aiCopyId, title:'Preview AI Fixture Copy', createdAt:new Date().toISOString(), aiMetadata:{adjustedFromRecipeId:originalId,adjustedAt:new Date().toISOString()} };
  request(users[0], '/api/recipes/save', 'POST', { recipe:aiCopy, operation:'create' });
  request(users[0], '/api/recipes/save', 'POST', { recipe:aiCopy, operation:'create' });
  aLibrary = request(users[0], '/api/recipes');
  assert.strictEqual(aLibrary.filter((r) => r.id === aiCopyId).length, 1);
  assert.strictEqual(aLibrary.find((r) => r.id === aiCopyId).aiMetadata.adjustedFromRecipeId, originalId);
  assert.strictEqual(aLibrary.find((r) => r.id === originalId).title, edited.title);
  const secondCopy = { ...aiCopy, id:aiSecondId, createdAt:new Date().toISOString() };
  request(users[0], '/api/recipes/save', 'POST', { recipe:secondCopy, operation:'create' });
  checks.push('AI fixture copy provenance and retry semantics');

  const invalid = request(users[0], '/api/recipes/save', 'POST', { recipe:{...edited,category:'Not A Real Category'}, operation:'update' });
  assert.match(invalid.error || '', /not allowed/);
  aLibrary = request(users[0], '/api/recipes');
  assert.strictEqual(aLibrary.find((r) => r.id === originalId).category, 'Entrées');
  checks.push('invalid category rejected without mutation');

  request(users[0], '/api/recipes/save', 'POST', { recipe:{...edited,category:'Baked Goods'}, operation:'move' });
  aLibrary = request(users[0], '/api/recipes');
  assert.strictEqual(aLibrary.find((r) => r.id === originalId).category, 'Baked Goods');
  request(users[0], '/api/recipes/save', 'POST', { recipe:edited, operation:'move' });
  checks.push('move to Baked Goods and back persists');

  const bLibraryBefore = request(users[1], '/api/recipes');
  assert.ok(!bLibraryBefore.some((r) => r.id === originalId));
  const collision = recipe(originalId, 'User B Isolated Collision', 'Sides');
  request(users[1], '/api/recipes/save', 'POST', { recipe:collision, operation:'update' });
  const bLibraryAfter = request(users[1], '/api/recipes');
  assert.strictEqual(bLibraryAfter.find((r) => r.id === originalId).title, collision.title);
  aLibrary = request(users[0], '/api/recipes');
  assert.strictEqual(aLibrary.find((r) => r.id === originalId).title, edited.title);
  assert.ok(!aLibrary.some((r) => r.title === collision.title));
  checks.push('cross-user ID collision remains fully isolated');

  console.log(JSON.stringify({ ok:true, checks, requestReferencesObserved:true, liveAiUsed:false }));
} finally {
  const cleanup = [];
  for (let i = 0; i < created; i++) {
    try { cleanup.push(request(users[i], '/api/auth/delete-account', 'POST', { password:users[i].password }).ok === true); }
    catch { cleanup.push(false); }
  }
  try { fs.rmSync(tempDir, { recursive:true, force:true }); } catch {}
  console.log(JSON.stringify({ cleanupAttempted:created, cleanupSucceeded:cleanup.filter(Boolean).length }));
  if (cleanup.some((ok) => !ok)) process.exitCode = 1;
}
