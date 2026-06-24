const assert = require("assert");
const http = require("http");
const app = require("../server");
const { fetchWithTimeout, readBodyCapped, isAbortError } = app._test;

(async () => {
  // --- isAbortError detection ---
  assert.strictEqual(isAbortError({ name: "AbortError" }), true);
  assert.strictEqual(isAbortError(new Error("The operation was aborted")), true);
  assert.strictEqual(isAbortError(new Error("network is down")), false);

  // --- readBodyCapped: under cap returns text, over cap returns null ---
  assert.strictEqual(await readBodyCapped(new Response("hello world"), 1000), "hello world");
  assert.strictEqual(await readBodyCapped(new Response("x".repeat(5000)), 1000), null, "over-cap body returns null");

  // --- fetchWithTimeout aborts a hanging server promptly ---
  const server = http.createServer(() => { /* never responds */ });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const started = Date.now();
  let aborted = false;
  try {
    await fetchWithTimeout("http://127.0.0.1:" + port + "/", {}, 300);
  } catch (err) {
    aborted = true;
    assert.ok(isAbortError(err), "timeout rejects with an AbortError");
  }
  server.close();
  assert.ok(aborted, "fetchWithTimeout rejected on timeout");
  assert.ok(Date.now() - started < 2500, "aborted promptly (~timeout, not hung)");

  console.log("import-reliability-test: ok");
})().catch((err) => { console.error(err); process.exit(1); });
