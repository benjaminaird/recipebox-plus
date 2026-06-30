#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const reportPath = path.join(__dirname, "..", "tests", "results", "imports", "nightmare-report.json");
assert.ok(fs.existsSync(reportPath), "nightmare report exists");

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const summary = report.summary || {};
const results = report.results || [];

assert.strictEqual(summary.manifest_count, 100, "manifest count is reported");
assert.strictEqual(summary.recipes_tested, results.length, "recipes tested matches result rows");
assert.strictEqual(summary.attempted_count + summary.skipped_count, summary.recipes_tested, "attempted + skipped equals tested");
assert.ok(Number.isFinite(summary.pass_rate_among_attempted), "pass rate among attempted is numeric");
assert.ok(Number.isFinite(summary.true_fail_rate_among_attempted), "true fail rate among attempted is numeric");
assert.ok(Number.isFinite(summary.total_coverage_rate), "total coverage rate is numeric");
assert.ok(summary.ai_fallback_pass_rate === null || Number.isFinite(summary.ai_fallback_pass_rate), "AI pass rate is null or numeric");
assert.ok(summary.confidence_by_source_type && typeof summary.confidence_by_source_type === "object", "confidence by source type is present");
assert.strictEqual(typeof summary.ai_fallback_requested, "boolean", "AI fallback requested flag is present");
assert.strictEqual(summary.ai_fallback_implemented, false, "AI fallback implementation status is explicit");
assert.strictEqual(typeof summary.ai_key_available, "boolean", "AI key availability is explicit");
assert.ok(Number.isFinite(summary.estimated_ai_fallback_candidates), "AI fallback candidate estimate is numeric");
assert.ok(Number.isFinite(summary.estimated_ai_credits_if_run), "AI fallback credit estimate is numeric");
assert.ok(Array.isArray(summary.top10_nightmare_status), "top 10 nightmare status is present");
assert.ok(Array.isArray(summary.top25_must_pass_status), "top 25 must-pass status is present");
assert.ok(Array.isArray(summary.true_failures), "true failures list is present");
assert.ok(Array.isArray(summary.skipped_but_acceptable_cases), "acceptable skipped list is present");
assert.ok(Array.isArray(summary.skipped_and_needs_product_work_cases), "product-work skipped list is present");
assert.ok(Array.isArray(summary.top_fixed_failure_categories), "fixes applied list is present");

const skipped = results.filter((r) => r.import_status === "skipped");
for (const row of skipped) {
  assert.ok(row.skip_classification, `${row.id} has a skip classification`);
  assert.ok(row.skip_acceptability, `${row.id} has skip acceptability`);
}

const attempted = results.filter((r) => r.import_status !== "skipped");
const expectedPassRate = attempted.length ? Number(((summary.counts.pass / attempted.length) * 100).toFixed(1)) : null;
assert.strictEqual(summary.pass_rate_among_attempted, expectedPassRate, "pass rate excludes skipped imports");

console.log("nightmare-report-test: ok");
