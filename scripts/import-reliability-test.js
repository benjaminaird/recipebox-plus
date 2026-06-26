const assert = require("assert");
const http = require("http");
const app = require("../server");
const { fetchWithTimeout, readBodyCapped, isAbortError, isPrivateIp, assertPublicHost } = app._test;

async function rejects(promise, label) {
  let threw = false;
  try { await promise; } catch { threw = true; }
  assert.ok(threw, label);
}
async function resolves(promise, label) {
  try { await promise; } catch (e) { assert.fail(label + " (threw: " + e.message + ")"); }
}

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

  // --- SSRF guard: private/reserved IPs are blocked, public IPs allowed ---
  ["127.0.0.1", "10.0.0.1", "172.16.5.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1"]
    .forEach((ip) => assert.strictEqual(isPrivateIp(ip), true, ip + " should be private/blocked"));
  ["8.8.8.8", "1.1.1.1", "172.32.0.1", "151.101.1.140", "2606:4700:4700::1111"]
    .forEach((ip) => assert.strictEqual(isPrivateIp(ip), false, ip + " should be public"));

  // assertPublicHost: these resolve without network (literal IPs / localhost short-circuit).
  await rejects(assertPublicHost("localhost"), "localhost blocked");
  await rejects(assertPublicHost("127.0.0.1"), "loopback IP blocked");
  await rejects(assertPublicHost("169.254.169.254"), "cloud metadata IP blocked");
  await rejects(assertPublicHost("10.1.2.3"), "private IP blocked");
  await rejects(assertPublicHost("foo.internal"), "internal hostname blocked");
  // Numeric/octal/hex-encoded loopback forms must be rejected pre-DNS so an
  // attacker can't sneak 127.0.0.1 past the guard via an alternate encoding.
  await rejects(assertPublicHost("2130706433"), "decimal-encoded loopback blocked");
  await rejects(assertPublicHost("0x7f000001"), "hex-encoded loopback blocked");
  await rejects(assertPublicHost("0177.0.0.1"), "octal-labeled loopback blocked");
  await rejects(assertPublicHost("0x7f.0.0.1"), "hex-labeled loopback blocked");
  await resolves(assertPublicHost("8.8.8.8"), "public literal IP allowed");

  console.log("import-reliability-test: ok");
})().catch((err) => { console.error(err); process.exit(1); });
