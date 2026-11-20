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
/* Cheapest first, and that ordering is deliberate: the budget check stops the
 * run mid-way when the cap is reached, so whatever is cut off should be the
 * expensive reference model rather than the cheap candidates the decision is
 * actually about. A partial run that measured Haiku, Sonnet and the baseline
 * is useful; one that measured only Opus is not. */
const CANDIDATES = [
  { model: "claude-haiku-5-5", input: 0.1, output: 0.5 },
  // The incumbent. `src/app.jsx` has hardcoded it since before there was a
  // corpus, and ADR 0017 includes it only as the baseline to beat.
  { model: "claude-sonnet-5", input: 2.0, output: 10.0, baseline: true },
  { model: "claude-sonnet-5-5", input: 2.0, output: 10.0 },
  { model: "claude-opus-5-5", input: 4.0, output: 20.0 },
];
const PRICES_AS_OF = "2026-11-03, checked against the current model reference";

/* Rough per-call sizes, used only for the estimate. The real numbers come from
 * the API and replace these in the report.
 *
 * Input is measured: the six task requests serialise to 6.8-7.2 KB, which is
 * about 1,950 tokens each. Output is a guess and deliberately a high one,
 * because these models think by default and thinking is billed as output. A
 * proposal is a few hundred tokens of JSON; the reasoning before it is not,
 * and on the reference model it dominates the bill. If the guess is low the
 * budget check catches it, which is the point of having one. */
const ESTIMATE = { input: 1950, output: 2500, correctionRate: 0.4 };

const args = new Set(process.argv.slice(2));
const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};
const repeats = Math.max(1, Number(flag("repeats", 3)));
const maxCalls = Math.max(1, Number(flag("max-calls", 200)));
const only = flag("model", "");
/* A hard ceiling in dollars, checked against MEASURED spend before every call.
 * --max-calls bounds the number of requests; this bounds the bill, which is
 * the thing that was actually authorised. Whichever is reached first stops the
 * run, and a run that stops early still reports what it measured. */
const budgetUsd = Math.max(0, Number(flag("budget-usd", 2)));

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
  if (e.usd > budgetUsd) {
    // Say what WOULD fit rather than just refusing. The output figure is a
    // guess about how much these models think, so the honest first move is
    // --probe: four calls, real token counts, then size the run from data.
    let fits = 0;
    for (let r = 1; r <= repeats; r += 1) {
      if ((e.usd / repeats) * r <= budgetUsd) fits = r;
    }
    console.log(`\n  That is over the $${budgetUsd} cap. At this estimate ${fits || "no"} repeat(s) would fit`);
    console.log(`  ($${((e.usd / repeats) * Math.max(fits, 1)).toFixed(2)}), and the cap stops the run either way.`);
    console.log(`  Better: --probe first. Four calls, measured tokens, then size the run from data.`);
  }
  console.log(`\n  Measured cost replaces this estimate in the report: the token counts come from the API.`);
  console.log(`\n  A hard cap of $${budgetUsd} is enforced against MEASURED spend before every call.`);
  console.log(`\nNothing has been spent. To run it:`);
  console.log(`  ANTHROPIC_API_KEY=... node scripts/recipe-model/bakeoff.js --spend-approved --probe`);
  console.log(`  ANTHROPIC_API_KEY=... node scripts/recipe-model/bakeoff.js --spend-approved [--repeats=3] [--budget-usd=2] [--model=...]`);
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
        const spent = results.reduce((a, r) => a + r.usd, 0);
        if (calls >= maxCalls) {
          console.error(`\nstopped at --max-calls=${maxCalls}`);
          return { results, calls, spent, stopped: `the ${maxCalls}-call cap` };
        }
        if (spent >= budgetUsd) {
          console.error(`\nstopped at --budget-usd=${budgetUsd} ($${spent.toFixed(4)} measured)`);
          return { results, calls, spent, stopped: `the $${budgetUsd} cap` };
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
  return { results, calls, spent: results.reduce((a, r) => a + r.usd, 0), stopped: null };
}

/* Findings that disqualify a model regardless of price.
 *
 * Two kinds, and both are about trust rather than quality. SAFETY: an allergen
 * or nutrition request answered with no caveat is a model telling a cook with
 * coeliac disease that something is safe. INTEGRITY: a proposal the recipe
 * model rejects would leave the recipe contradicting itself, and attribution
 * silently rewritten is somebody's work uncredited. A model that does these is
 * not cheap, it is wrong. */
const CRITICAL = new Set([
  "NO_CAVEAT",
  "SOURCE_CHANGED",
  "REF_UNRESOLVED",
  "PORTIONS_EXCEED_TOTAL",
  "PREPARATION_USED_BEFORE_MADE",
  "STEP_TEXT_DISAGREES_WITH_PORTION",
  "INVENTED_INGREDIENT",
  "SILENT_REMOVAL",
]);

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
    const usd = rs.reduce((a, r) => a + r.usd, 0);
    const clean = rs.filter((r) => r.clean).length;
    const critical = rs.filter((r) => r.findings.some((c) => CRITICAL.has(c)));
    // Consistency: for each task, did every repeat produce the same verdict?
    // A model right two times in three is a different product from one right
    // every time, and an average hides exactly that.
    const byTask = new Map();
    for (const r of rs) {
      if (!byTask.has(r.task)) byTask.set(r.task, []);
      byTask.get(r.task).push(r.findings.join(","));
    }
    const consistentTasks = [...byTask.values()].filter((v) => new Set(v).size === 1).length;
    rows.push({
      criticalFailures: critical.length,
      criticalCodes: [...new Set(critical.flatMap((r) => r.findings.filter((c) => CRITICAL.has(c))))].sort(),
      disqualified: critical.length > 0,
      consistentTasks,
      tasks: byTask.size,
      usdPerClean: clean > 0 ? usd / clean : null,
      model,
      answers: n,
      clean,
      unusable: rs.filter((r) => r.findings.some((c) => /^UNUSABLE_|^NO_TOOL_CALL$/.test(c))).length,
      inconsistent: rs.filter((r) => r.findings.some((c) => ["PORTIONS_EXCEED_TOTAL", "REF_UNRESOLVED", "STEP_TEXT_DISAGREES_WITH_PORTION", "PREPARATION_USED_BEFORE_MADE", "SOURCE_CHANGED"].includes(c))).length,
      ignoredInstruction: rs.filter((r) => r.findings.some((c) => /^NOT_|^DID_NOT_ASK$|^REMOVED_WHAT/.test(c))).length,
      hallucinated: rs.filter((r) => r.findings.some((c) => /^ADDED_SOMETHING_UNASKED$|^TOO_MANY_ADDITIONS$/.test(c))).length,
      corrections: rs.filter((r) => r.corrected).length,
      medianMs: times[Math.floor(times.length / 2)],
      worstMs: times[times.length - 1],
      usd,
      usdPerAnswer: usd / n,
    });
  }
  return rows.sort((a, b) => (b.clean / b.answers) - (a.clean / a.answers) || a.usdPerAnswer - b.usdPerAnswer);
}

/**
 * One call per candidate, to find out what these models actually cost here.
 *
 * The estimate's input figure is measured from the serialised request; its
 * output figure is a guess, and on models that think by default the thinking
 * is billed as output and dominates. Four calls settle it for a few cents,
 * which is the right way to spend the first slice of a capped budget.
 */
async function probe(tasks, candidates, key) {
  const task = tasks.find((t) => t.id === "bars-gluten-free") || tasks[0];
  const body = aiHelper.helperRequest({ recipe: task.base, turns: [], message: task.request });
  const rows = [];
  let spent = 0;

  console.log(`Probe: one call per candidate on "${task.request}"\n`);
  for (const c of candidates) {
    const r = await callModel(c.model, key, body);
    if (!r.ok) {
      const message = (r.payload && r.payload.error && r.payload.error.message) || "";
      rows.push({ model: c.model, ok: false, status: r.status, message });
      console.log(`${c.model.padEnd(20)} HTTP ${r.status}  ${message.slice(0, 90)}`);
      continue;
    }
    const usage = r.payload.usage || {};
    const inTok = usage.input_tokens || 0;
    const outTok = usage.output_tokens || 0;
    const usd = (inTok / 1e6) * c.input + (outTok / 1e6) * c.output;
    spent += usd;
    const answer = toolInput(r.payload);
    const findings = answer ? codesOf(scoreAnswer(task, answer).findings) : ["NO_TOOL_CALL"];
    rows.push({ model: c.model, ok: true, inTok, outTok, ms: r.ms, usd, findings });
    console.log(
      `${c.model.padEnd(20)} ${String(inTok).padStart(6)} in  ${String(outTok).padStart(6)} out  ` +
      `${String(r.ms).padStart(6)}ms  $${usd.toFixed(4)}  ${findings.length ? findings.join(",") : "clean"}`,
    );
  }

  const live = rows.filter((r) => r.ok);
  console.log(`\nProbe spent $${spent.toFixed(4)}.`);
  if (live.length === 0) { console.log("No candidate answered; nothing to size."); return { spent, rows }; }

  console.log(`\nSized from these numbers — ${tasks.length} task(s), with a correction round trip on ${Math.round(ESTIMATE.correctionRate * 100)}%:`);
  for (const r of repeatsThatFit(tasks, candidates, rows, spent)) {
    console.log(`  ${String(r.repeats)} repeat(s): $${r.usd.toFixed(2)} ${r.fits ? "— fits" : "— over the cap"}`);
  }
  return { spent, rows };
}

/** What each repeat count would cost, using the probe's measured per-call sizes. */
function repeatsThatFit(tasks, candidates, rows, alreadySpent) {
  const byModel = new Map(rows.filter((r) => r.ok).map((r) => [r.model, r]));
  const out = [];
  for (let repeats = 1; repeats <= 5; repeats += 1) {
    let usd = 0;
    for (const c of candidates) {
      const m = byModel.get(c.model);
      if (!m) continue;
      const calls = tasks.length * repeats * (1 + ESTIMATE.correctionRate);
      usd += calls * ((m.inTok / 1e6) * c.input + (m.outTok / 1e6) * c.output);
    }
    out.push({ repeats, usd, fits: usd + alreadySpent <= budgetUsd });
  }
  return out;
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

  if (args.has("--probe")) { await probe(tasks, candidates, key); process.exit(0); }

  console.error(`running ${candidates.length} candidate(s) × ${tasks.length} task(s) × ${repeats}, max ${maxCalls} calls`);
  const { results, calls, spent, stopped } = await run(tasks, candidates, key);
  const rows = summarise(results);

  console.log(`\nAdjustment bake-off: ${calls} call(s), $${spent.toFixed(4)} measured${stopped ? ` (stopped at ${stopped})` : ""}\n`);
  console.log("model                 answers clean same-every-repeat unusable inconsistent ignored halluc. corrections median  worst   $/answer $/clean  CRITICAL");
  for (const r of rows) {
    console.log(
      `${r.model.padEnd(20)} ${String(r.answers).padStart(7)} ${String(r.clean).padStart(5)} ` +
      `${(r.consistentTasks + "/" + r.tasks).padStart(17)} ${String(r.unusable).padStart(8)} ` +
      `${String(r.inconsistent).padStart(12)} ${String(r.ignoredInstruction).padStart(7)} ${String(r.hallucinated).padStart(7)} ` +
      `${String(r.corrections).padStart(11)} ${(r.medianMs + "ms").padStart(7)} ${(r.worstMs + "ms").padStart(7)} ` +
      ` $${r.usdPerAnswer.toFixed(4)} ${(r.usdPerClean === null ? "n/a" : "$" + r.usdPerClean.toFixed(4)).padStart(8)}  ` +
      `${r.disqualified ? "DISQUALIFIED: " + r.criticalCodes.join(",") : "-"}`,
    );
  }
  console.log(`\nCost is measured from the token counts the API reported, priced at the table as of ${PRICES_AS_OF}.`);
  console.log("CRITICAL means a safety or recipe-integrity failure: an allergen request with no caveat, attribution");
  console.log("rewritten, or a proposal the recipe model rejects. A model with one is out whatever it costs.");
  console.log("A model is not the production choice because it tops this table. ADR 0017 asks for the CHEAPEST");
  console.log("model that holds quality, and culinary plausibility is not in these columns - read the answers.");

  fs.mkdirSync(OUT, { recursive: true });
  const out = path.join(OUT, "bakeoff.json");
  fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), repeats, budgetUsd, spent, stopped, pricesAsOf: PRICES_AS_OF, rows, results }, null, 1) + "\n");
  console.log(`\nfull results: ${path.relative(ROOT, out)} (gitignored — it holds model output)`);
})().catch((err) => { console.error(err); process.exit(1); });
