#!/usr/bin/env node
"use strict";
/*
 * The adjustment bake-off (ADR 0017): which model should the Recipe Helper use.
 *
 * It spends real money, so the default is to spend nothing. With no arguments
 * it prints the plan and what it would cost and exits — which is the state the
 * repository is in and will stay in until a budget is agreed
 * (docs/ai-helper-evaluation-plan.md). Running it for real takes BOTH a key and
 * `--spend-approved`, and stops at `--max-calls` whatever happens.
 *
 * What it measures, per candidate model:
 *
 *   structured-output validity   did an answer survive readProposal at all
 *   instruction following        did the cook's request actually happen
 *   consistency                  did the recipe model accept the result
 *   hallucination                ingredients added that nobody asked for
 *   latency                      wall clock, per call, as a cook would feel it
 *   cost                         measured from the usage the API reports,
 *                                never from list price × a guess
 *
 * It calls through lib/ai-helper.js, so what is measured is the prompt and the
 * schema the server actually sends. A bake-off against a prompt written for the
 * bake-off measures the bake-off.
 */

const fs = require("fs");
const path = require("path");
const aiHelper = require("../../lib/ai-helper");
const { scoreAnswer, codesOf } = require("./tasks");

const ROOT = path.join(__dirname, "..", "..");
const TASKS = path.join(ROOT, "tests", "recipe-model", "tasks");
const OUT = path.join(ROOT, "tests", "recipe-model", "private", "out");

/**
 * Candidates and their prices, per million tokens, input / output.
 *
 * Copied from ADR 0017's table. A price here that is wrong makes the cost
 * column wrong, so the report prints the date it was taken and the measured
 * token counts beside it: the tokens are facts from the API, the money is
 * arithmetic on top of a number a human typed.
 */
const CANDIDATES = [
  { model: "claude-haiku-5-5", input: 0.1, output: 0.5 },
  { model: "claude-sonnet-5-5", input: 2.0, output: 10.0 },
  { model: "claude-opus-5-5", input: 4.0, output: 20.0 },
  // The incumbent. `src/app.jsx` has hardcoded it since before there was a
  // corpus, and ADR 0017 includes it only as the baseline to beat.
  { model: "claude-sonnet-5", input: 2.0, output: 10.0, baseline: true },
];
const PRICES_AS_OF = "2026-11-08 (ADR 0017)";

/* Rough per-call sizes, used only for the estimate. The real numbers come from
 * the API and replace these in the report. */
const ESTIMATE = { input: 2500, output: 600, correctionRate: 0.4 };

const args = new Set(process.argv.slice(2));
const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};
const repeats = Math.max(1, Number(flag("repeats", 3)));
const maxCalls = Math.max(1, Number(flag("max-calls", 80)));
const only = flag("model", "");

function loadTasks() {
  if (!fs.existsSync(TASKS)) return [];
  return fs.readdirSync(TASKS).filter((f) => f.endsWith(".task.json")).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(TASKS, f), "utf8")));
}

function estimate(tasks, candidates) {
  const perModel = tasks.length * repeats * (1 + ESTIMATE.correctionRate);
  const rows = candidates.map((c) => {
    const inTok = perModel * ESTIMATE.input;
    const outTok = perModel * ESTIMATE.output;
    return {
      model: c.model,
      calls: Math.ceil(perModel),
      usd: (inTok / 1e6) * c.input + (outTok / 1e6) * c.output,
    };
  });
  return { rows, calls: rows.reduce((n, r) => n + r.calls, 0), usd: rows.reduce((n, r) => n + r.usd, 0) };
}

function printPlan(tasks, candidates) {
  const e = estimate(tasks, candidates);
  console.log(`Adjustment bake-off plan (ADR 0017)\n`);
  console.log(`Tasks (${tasks.length}), each asked ${repeats}×:`);
  for (const t of tasks) console.log(`  ${t.id.padEnd(24)} "${t.request}"`);
  console.log(`\nCandidates, and what the whole run would cost at list price as of ${PRICES_AS_OF}:`);
  for (const r of e.rows) {
    const c = candidates.find((x) => x.model === r.model);
    console.log(`  ${r.model.padEnd(20)} ${String(r.calls).padStart(3)} calls   $${r.usd.toFixed(2)}${c.baseline ? "   (baseline to beat)" : ""}`);
  }
  console.log(`\n  total ${e.calls} calls, about $${e.usd.toFixed(2)} — assuming ~${ESTIMATE.input} input and ~${ESTIMATE.output} output tokens`);
  console.log(`  per call, and a correction round trip on ${Math.round(ESTIMATE.correctionRate * 100)}% of them.`);
  console.log(`\n  Measured cost replaces this estimate in the report: the token counts come from the API.`);
  console.log(`\nNothing has been spent. To run it:`);
  console.log(`  ANTHROPIC_API_KEY=… node scripts/recipe-model/bakeoff.js --spend-approved [--repeats=3] [--max-calls=80] [--model=…]`);
}

async function callModel(model, key, body) {
  const started = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(Object.assign({ model }, body)),
  });
  const payload = await response.json();
  return { ms: Date.now() - started, ok: response.ok, status: response.status, payload };
}

/** The tool call out of a response, or null when the model did not make one. */
function toolInput(payload) {
  const content = (payload && Array.isArray(payload.content)) ? payload.content : [];
  const call = content.find((c) => c && c.type === "tool_use" && c.name === "propose_adjustment");
  return call ? call.input : null;
}

async function run(tasks, candidates, key) {
  const results = [];
  let calls = 0;

  for (const candidate of candidates) {
    for (const task of tasks) {
      for (let attempt = 1; attempt <= repeats; attempt += 1) {
        if (calls >= maxCalls) {
          console.error(`\nstopped at --max-calls=${maxCalls}`);
          return { results, calls, stopped: true };
        }
        // The production request, byte for byte: same system prompt, same tool,
        // same recipe envelope.
        const body = aiHelper.helperRequest({ recipe: task.base, turns: [], message: task.request });
        calls += 1;
        const first = await callModel(candidate.model, key, body);
        let used = first;
        let corrected = false;
        let findings = [];
        let answer = null;

        if (first.ok) {
          answer = toolInput(first.payload);
          findings = answer ? scoreAnswer(task, answer).findings : [{ code: "NO_TOOL_CALL" }];
          // One correction, exactly as the endpoint does it, so the measurement
          // is of the pipeline a cook would use rather than of a single shot.
          const unusable = findings.some((f) => /^UNUSABLE_/.test(f.code)) ||
            findings.some((f) => ["PORTIONS_EXCEED_TOTAL", "REF_UNRESOLVED", "STEP_TEXT_DISAGREES_WITH_PORTION", "SOURCE_CHANGED"].includes(f.code));
          if (unusable && calls < maxCalls) {
            calls += 1;
            corrected = true;
            const retry = aiHelper.helperRequest({
              recipe: task.base, turns: [], message: task.request,
              problems: findings.map((f) => ({ code: f.code, detail: f.detail })),
            });
            used = await callModel(candidate.model, key, retry);
            if (used.ok) {
              answer = toolInput(used.payload);
              findings = answer ? scoreAnswer(task, answer).findings : [{ code: "NO_TOOL_CALL" }];
            }
          }
        } else {
          findings = [{ code: "API_ERROR", detail: String(used.status) }];
        }

        const usage = (used.payload && used.payload.usage) || {};
        const inTok = (first.payload && first.payload.usage ? first.payload.usage.input_tokens : 0) +
          (corrected ? (usage.input_tokens || 0) : 0);
        const outTok = (first.payload && first.payload.usage ? first.payload.usage.output_tokens : 0) +
          (corrected ? (usage.output_tokens || 0) : 0);

        results.push({
          model: candidate.model,
          task: task.id,
          attempt,
          corrected,
          ms: first.ms + (corrected ? used.ms : 0),
          inputTokens: inTok,
          outputTokens: outTok,
          usd: (inTok / 1e6) * candidate.input + (outTok / 1e6) * candidate.output,
          findings: codesOf(findings),
          clean: findings.length === 0,
        });
        process.stderr.write(findings.length === 0 ? "." : "x");
      }
    }
  }
  return { results, calls, stopped: false };
}

function summarise(results) {
  const byModel = new Map();
  for (const r of results) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model).push(r);
  }
  const rows = [];
  for (const [model, rs] of byModel) {
    const n = rs.length;
    const times = rs.map((r) => r.ms).sort((a, b) => a - b);
    rows.push({
      model,
      answers: n,
      clean: rs.filter((r) => r.clean).length,
      unusable: rs.filter((r) => r.findings.some((c) => /^UNUSABLE_|^NO_TOOL_CALL$/.test(c))).length,
      inconsistent: rs.filter((r) => r.findings.some((c) => ["PORTIONS_EXCEED_TOTAL", "REF_UNRESOLVED", "STEP_TEXT_DISAGREES_WITH_PORTION", "PREPARATION_USED_BEFORE_MADE", "SOURCE_CHANGED"].includes(c))).length,
      ignoredInstruction: rs.filter((r) => r.findings.some((c) => /^NOT_|^DID_NOT_ASK$|^REMOVED_WHAT/.test(c))).length,
      hallucinated: rs.filter((r) => r.findings.some((c) => /^ADDED_SOMETHING_UNASKED$|^TOO_MANY_ADDITIONS$/.test(c))).length,
      corrections: rs.filter((r) => r.corrected).length,
      medianMs: times[Math.floor(times.length / 2)],
      worstMs: times[times.length - 1],
      usd: rs.reduce((a, r) => a + r.usd, 0),
      usdPerAnswer: rs.reduce((a, r) => a + r.usd, 0) / n,
    });
  }
  return rows.sort((a, b) => (b.clean / b.answers) - (a.clean / a.answers) || a.usdPerAnswer - b.usdPerAnswer);
}

(async () => {
  const tasks = loadTasks();
  const candidates = only ? CANDIDATES.filter((c) => c.model === only) : CANDIDATES;
  if (tasks.length === 0) { console.error("no tasks in tests/recipe-model/tasks"); process.exit(1); }
  if (candidates.length === 0) { console.error(`--model=${only} is not a candidate`); process.exit(1); }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!args.has("--spend-approved") || !key) {
    printPlan(tasks, candidates);
    if (args.has("--spend-approved") && !key) console.error("\nANTHROPIC_API_KEY is not set, so nothing ran.");
    process.exit(0);
  }

  console.error(`running ${candidates.length} candidate(s) × ${tasks.length} task(s) × ${repeats}, max ${maxCalls} calls`);
  const { results, calls, stopped } = await run(tasks, candidates, key);
  const rows = summarise(results);

  console.log(`\nAdjustment bake-off: ${calls} call(s)${stopped ? " (stopped at the cap)" : ""}\n`);
  console.log("model                 answers  clean  unusable  inconsistent  ignored  halluc.  corrections  median  worst   $/answer");
  for (const r of rows) {
    console.log(
      `${r.model.padEnd(20)} ${String(r.answers).padStart(8)} ${String(r.clean).padStart(6)} ${String(r.unusable).padStart(9)} ` +
      `${String(r.inconsistent).padStart(13)} ${String(r.ignoredInstruction).padStart(8)} ${String(r.hallucinated).padStart(8)} ` +
      `${String(r.corrections).padStart(12)} ${(r.medianMs + "ms").padStart(7)} ${(r.worstMs + "ms").padStart(7)} ` +
      `  $${r.usdPerAnswer.toFixed(4)}`,
    );
  }
  console.log(`\nCost is measured from the token counts the API reported, priced at the table as of ${PRICES_AS_OF}.`);
  console.log("A model is not the production choice because it tops this table. ADR 0017 asks for the CHEAPEST");
  console.log("model that holds quality, and culinary plausibility is not in these columns — read the answers.");

  fs.mkdirSync(OUT, { recursive: true });
  const out = path.join(OUT, "bakeoff.json");
  fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), repeats, pricesAsOf: PRICES_AS_OF, rows, results }, null, 1) + "\n");
  console.log(`\nfull results: ${path.relative(ROOT, out)} (gitignored — it holds model output)`);
})().catch((err) => { console.error(err); process.exit(1); });
