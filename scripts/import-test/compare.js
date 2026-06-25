#!/usr/bin/env node
/*
 * Compare import-accuracy across model runs (results.<tag>.json files).
 * Usage: node compare.js haiku sonnet opus
 * Scores each test against the manifest truth data (knownIngredients, title)
 * already baked into each result's `expectation` block by run.js.
 */
const fs = require('fs');
const path = require('path');
const tags = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!tags.length) { console.error('usage: node compare.js <tag> [tag...]'); process.exit(1); }

const runs = {};
for (const tag of tags) {
  const p = path.join(__dirname, 'out', `results.${tag}.json`);
  if (!fs.existsSync(p)) { console.error('missing', p); process.exit(1); }
  runs[tag] = require(p);
}
// index by test id
const ids = runs[tags[0]].map((r) => r.id);
const byId = {};
for (const tag of tags) { byId[tag] = {}; for (const r of runs[tag]) byId[tag][r.id] = r; }

function recall(r) {
  const e = r && r.expectation;
  if (!e || !e.knownIngredients) return null;
  return e.foundIngredients / e.knownIngredients;
}
function pct(x) { return x == null ? '  -  ' : (x * 100).toFixed(0).padStart(3) + '%'; }
function cell(r) {
  if (!r) return '   --   ';
  if (!r.ok) return /budget/.test(r.status || '') ? '  skip  ' : '  JSON✗ ';
  const rc = recall(r);
  const t = r.expectation && r.expectation.titleMatch ? 'T' : (r.expectation && r.expectation.titleMatch === false ? 't' : '?');
  return `${pct(rc)} ${t}`;
}

// Per-test table
console.log('\n=== Per-test ingredient recall (known found / known total) + title (T=match t=miss) ===\n');
console.log('test'.padEnd(46) + tags.map((t) => t.padStart(10)).join(''));
// "common" = tests every model actually ran (excludes budget-skips) for fair apples-to-apples.
const common = ids.filter((id) => tags.every((t) => { const r = byId[t][id]; return r && (r.ok || !/budget/.test(r.status || '')); }));
const agg = {}; tags.forEach((t) => agg[t] = { recallSum: 0, recallN: 0, title: 0, titleN: 0, json: 0, skip: 0, cost: 0, ran: 0, perfect: 0, cRecallSum: 0, cRecallN: 0 });
for (const id of ids) {
  let line = id.padEnd(46);
  for (const tag of tags) {
    const r = byId[tag][id];
    line += cell(r).padStart(10);
    if (r) {
      agg[tag].cost += r.cost || 0;
      if (!r.ok && /budget/.test(r.status || '')) agg[tag].skip++;
      else if (!r.ok) agg[tag].json++;
      else {
        agg[tag].ran++;
        const rc = recall(r);
        if (rc != null) { agg[tag].recallSum += rc; agg[tag].recallN++; if (rc >= 0.999) agg[tag].perfect++; if (common.includes(id)) { agg[tag].cRecallSum += rc; agg[tag].cRecallN++; } }
        if (r.expectation && r.expectation.titleMatch != null) { agg[tag].titleN++; if (r.expectation.titleMatch) agg[tag].title++; }
      }
    }
  }
  console.log(line);
}

console.log('\n=== Aggregate ===\n');
console.log('metric'.padEnd(34) + tags.map((t) => t.padStart(12)).join(''));
const row = (label, fn) => console.log(label.padEnd(34) + tags.map((t) => String(fn(agg[t], t)).padStart(12)).join(''));
row('tests OK (parsed)', (a) => `${a.ran}/${ids.length}`);
row('JSON failures', (a) => a.json);
row('budget-skipped', (a) => a.skip);
row('avg ingredient recall', (a) => a.recallN ? (a.recallSum / a.recallN * 100).toFixed(1) + '%' : '-');
row(`recall on common ${common.length}`, (a) => a.cRecallN ? (a.cRecallSum / a.cRecallN * 100).toFixed(1) + '%' : '-');
row('perfect recall (100%)', (a) => `${a.perfect}/${a.recallN}`);
row('title match', (a) => a.titleN ? `${a.title}/${a.titleN}` : '-');
row('total cost', (a) => '$' + a.cost.toFixed(4));
row('avg cost / import', (a) => a.ran ? '$' + (a.cost / a.ran).toFixed(4) : '-');

// Where do models miss ingredients? (union of any missing)
console.log('\n=== Missing ingredients by test (any model) ===\n');
for (const id of ids) {
  const misses = tags.map((tag) => {
    const r = byId[tag][id];
    const m = r && r.ok && r.expectation ? (r.expectation.missingIngredients || []) : null;
    return { tag, m, ok: r && r.ok };
  });
  if (misses.every((x) => x.ok && (!x.m || !x.m.length))) continue; // all perfect
  console.log(id);
  for (const x of misses) {
    if (!x.ok) console.log(`   ${x.tag.padEnd(8)} JSON-fail`);
    else console.log(`   ${x.tag.padEnd(8)} ${x.m && x.m.length ? 'missing: ' + x.m.join(', ') : 'all found'}`);
  }
}
