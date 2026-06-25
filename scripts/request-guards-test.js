const assert = require("assert");
const http = require("http");
const app = require("../server");
const { resolveMonthlyCostCap } = app._test;

// --- Wallet circuit breaker default ---
delete process.env.AI_MONTHLY_GLOBAL_MAX_COST_USD;
assert.strictEqual(resolveMonthlyCostCap(), 75, "default monthly cost cap is $75 when unset");
process.env.AI_MONTHLY_GLOBAL_MAX_COST_USD = "0";
assert.strictEqual(resolveMonthlyCostCap(), 0, "cap of 0 disables the breaker");
process.env.AI_MONTHLY_GLOBAL_MAX_COST_USD = "150";
assert.strictEqual(resolveMonthlyCostCap(), 150, "env overrides the cap");
delete process.env.AI_MONTHLY_GLOBAL_MAX_COST_USD;

(async () => {
  // --- Per-route body limits ---
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const big = "x".repeat(2 * 1024 * 1024); // 2 MB
  const post = (path, body, method) => fetch("http://127.0.0.1:" + port + path, {
    method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  // A small-limit route (default 1 MB) must reject a 2 MB body with 413.
  const feedback = await post("/api/feedback", { type: "bug", message: big });
  assert.strictEqual(feedback.status, 413, "2MB body to /api/feedback is rejected (413), got " + feedback.status);

  // The recipe sync route gets a large limit, so 2 MB is parsed (not 413) — it
  // then fails auth/db, which is fine; we only assert it wasn't size-rejected.
  const recipes = await post("/api/recipes", { recipes: [{ notes: big }] }, "PUT");
  assert.ok(recipes.status !== 413, "2MB body to /api/recipes is NOT size-rejected, got " + recipes.status);

  server.close();
  console.log("request-guards-test: ok");
})().catch((e) => { console.error(e); process.exit(1); });
