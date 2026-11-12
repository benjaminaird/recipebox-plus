const assert = require("assert");
const http = require("http");
const app = require("../server");
const { fetchWithTimeout, pinnedFetch, safeFetch, readBodyCapped, isAbortError, isPrivateIp, ipv6ToBytes, assertPublicHost, looksBlockedPage } = app._test;

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

  // --- An IPv6 range is a range, not a spelling ---
  // The list above is every spelling an earlier isPrivateIp got right. It
  // compared strings, so seventeen addresses that must never be fetched were
  // judged public, and `new URL()` normalises almost none of them away:
  // [::ffff:7f00:1] IS 127.0.0.1, and a fetch through it reached a service on
  // loopback. Each entry below was one of those holes.
  [
    ["0:0:0:0:0:0:0:1", "loopback, written out in full"],
    ["0000:0000:0000:0000:0000:0000:0000:0001", "loopback, every hextet padded"],
    ["::ffff:7f00:1", "IPv4-mapped loopback in hex, not dotted"],
    ["::ffff:7f00:0001", "same, padded"],
    ["0:0:0:0:0:ffff:7f00:1", "same, uncompressed"],
    ["::ffff:a9fe:a9fe", "IPv4-mapped 169.254.169.254 - cloud metadata"],
    ["::ffff:0a00:1", "IPv4-mapped 10.0.0.1"],
    ["::ffff:ac1f:1", "IPv4-mapped 172.31.0.1"],
    ["::ffff:c0a8:1", "IPv4-mapped 192.168.0.1"],
    ["::ffff:6440:1", "IPv4-mapped 100.64.0.1, CGNAT"],
    ["::7f00:1", "IPv4-compatible loopback (::/96, deprecated but routable)"],
    ["::127.0.0.1", "IPv4-compatible loopback, dotted"],
    ["::a9fe:a9fe", "IPv4-compatible cloud metadata"],
    ["64:ff9b::7f00:1", "NAT64 well-known prefix carrying loopback"],
    ["64:ff9b::127.0.0.1", "NAT64, dotted"],
    ["2002:7f00:1::1", "6to4 carrying loopback in bytes 2-5"],
    ["2002:a9fe:a9fe::1", "6to4 carrying cloud metadata"],
    ["febf::1", "link-local - fe80::/10 is ten bits, so febf is in it"],
    ["fe9a::1", "link-local, mid-range"],
    ["fdff::1", "unique local"],
    ["ff02::1", "multicast, all nodes on the link"],
    ["ff00::1", "multicast"],
    ["fe80::1%eth0", "link-local with a zone index naming a local interface"],
    ["FE80::1", "uppercase"],
    ["::FFFF:7F00:1", "uppercase IPv4-mapped loopback"],
  ].forEach(([ip, why]) => assert.strictEqual(isPrivateIp(ip), true, ip + " must be blocked - " + why));

  // Public addresses must stay fetchable; a guard that blocks everything is
  // not a guard, it is an outage.
  [
    ["2606:2800:220:1:248:1893:25c8:1946", "example.com"],
    ["2a00:1450:4001:800::200e", "a public host"],
    ["2001:db8::1", "documentation prefix - reserved, but not internal"],
    ["2003::1", "public, and adjacent to the Teredo prefix 2001::/32"],
  ].forEach(([ip, why]) => assert.strictEqual(isPrivateIp(ip), false, ip + " must stay allowed - " + why));

  // Nonsense must not be mistaken for an address in a blocked range, and must
  // not throw either: isPrivateIp is called on whatever DNS hands back.
  ["", null, undefined, "not-an-ip", "::ffff:999.1.1.1", "1:2:3:4:5:6:7:8:9", "::g", "127.0.0.1.1"]
    .forEach((junk) => assert.strictEqual(isPrivateIp(junk), false, JSON.stringify(junk) + " is not an IP"));

  // The expansion itself, since every verdict above rests on it.
  assert.deepStrictEqual(ipv6ToBytes("::1"), [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]);
  assert.deepStrictEqual(ipv6ToBytes("::"), new Array(16).fill(0));
  assert.deepStrictEqual(ipv6ToBytes("::ffff:7f00:1"), [0,0,0,0,0,0,0,0,0,0,255,255,127,0,0,1]);
  assert.deepStrictEqual(ipv6ToBytes("::ffff:127.0.0.1"), ipv6ToBytes("::ffff:7f00:1"),
    "the dotted and hex spellings of one address expand identically");
  assert.deepStrictEqual(ipv6ToBytes("0:0:0:0:0:0:0:1"), ipv6ToBytes("::1"),
    "compressed and uncompressed expand identically");
  assert.strictEqual(ipv6ToBytes("fe80::1")[0], 254);
  assert.strictEqual(ipv6ToBytes("8.8.8.8"), null, "an IPv4 address is not IPv6");
  assert.strictEqual(ipv6ToBytes("nonsense"), null);
  assert.strictEqual(ipv6ToBytes(""), null);

  // assertPublicHost must refuse the BRACKETED literal, which is the form that
  // actually arrives from new URL().hostname.
  for (const literal of ["[::ffff:7f00:1]", "[::ffff:a9fe:a9fe]", "[::7f00:1]", "[febf::1]", "[64:ff9b::7f00:1]", "[ff02::1]"]) {
    await rejects(assertPublicHost(literal), literal + " blocked as a bracketed URL hostname");
  }
  // And the reason the hex form mattered: the URL parser does not rewrite it
  // into the dotted form the old regex looked for.
  assert.strictEqual(new URL("http://[::ffff:7f00:1]/").hostname, "[::ffff:7f00:1]",
    "new URL() keeps the hex spelling, so the guard must understand it");
  assert.strictEqual(new URL("http://[0:0:0:0:0:0:0:1]/").hostname, "[::1]",
    "it does compress this one, which is why that spelling was never exploitable");
  await resolves(assertPublicHost("[2606:2800:220:1:248:1893:25c8:1946]"), "a public IPv6 literal is still allowed");

  // assertPublicHost returns what it judged, so the connection can be pinned
  // to exactly those addresses instead of resolving the name a second time.
  assert.deepStrictEqual(await assertPublicHost("8.8.8.8"), ["8.8.8.8"], "a literal host returns itself");

  // --- DNS pinning: the connection goes where the GUARD looked, not where ---
  // --- the name points when the socket opens                              ---
  // assertPublicHost resolves and judges; global fetch() would then resolve
  // again, and a record with a short TTL can answer public for the check and
  // private for the connection. pinnedFetch closes that by handing node's
  // http lookup only the addresses already judged.
  const zlib = require("zlib");
  const pinServer = http.createServer((req, res) => {
    if (req.url === "/gzip") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end(zlib.gzipSync("<!doctype html><title>compressed</title>"));
      return;
    }
    if (req.url === "/br") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "br" });
      res.end(zlib.brotliCompressSync("<!doctype html><title>brotli</title>"));
      return;
    }
    if (req.url === "/304") { res.writeHead(304); res.end(); return; }
    if (req.url === "/moved") { res.writeHead(302, { location: "/" }); res.end(); return; }
    res.writeHead(200, { "content-type": "text/html", "x-seen-host": String(req.headers.host) });
    res.end("<!doctype html><title>pinned</title>");
  });
  await new Promise((resolve) => pinServer.listen(0, "127.0.0.1", resolve));
  const pinPort = pinServer.address().port;

  {
    // The hostname says example.com; the pin says loopback. The connection
    // follows the pin -- which is how a rebinding answer gets ignored.
    const r = await pinnedFetch(`http://example.com:${pinPort}/`, {}, 5000, ["127.0.0.1"]);
    assert.strictEqual(r.status, 200);
    assert.match(await r.text(), /pinned/, "the pinned address is the one connected to");
    assert.strictEqual(r.ok, true, "Response.ok survives");
    assert.strictEqual(r.url, `http://example.com:${pinPort}/`, "Response.url is the requested URL, which callers read as finalUrl");
  }
  {
    // The Host header and TLS SNI keep the hostname, which is why pinning the
    // lookup is safe where rewriting the URL to the IP would break HTTPS.
    const r = await pinnedFetch(`http://example.com:${pinPort}/`, {}, 5000, ["127.0.0.1"]);
    assert.strictEqual(r.headers.get("x-seen-host"), `example.com:${pinPort}`, "the server sees the hostname, not the pinned IP");
  }
  {
    // The reverse: a name that resolves to loopback must not reach loopback
    // when the pin is a public address.
    let reached = false;
    try {
      const r = await pinnedFetch(`http://localhost:${pinPort}/`, {}, 2000, ["93.184.216.34"]);
      reached = /pinned/.test(await r.text());
    } catch { /* refused or timed out: either way it did not arrive */ }
    assert.strictEqual(reached, false, "a public pin must not reach a loopback service");
  }
  {
    // http.request does no decompression and global fetch did, so pinnedFetch
    // has to. A mislabelled or undone body here would hand the extractor
    // binary rubbish that merely looks like a failed import.
    const gz = await pinnedFetch(`http://example.com:${pinPort}/gzip`, {}, 5000, ["127.0.0.1"]);
    assert.match(await gz.text(), /<title>compressed<\/title>/, "gzip is decompressed");
    assert.strictEqual(gz.headers.get("content-encoding"), null, "the encoding header is dropped once undone");
    assert.strictEqual(gz.headers.get("content-length"), null, "and so is a length that no longer describes the bytes");
    const br = await pinnedFetch(`http://example.com:${pinPort}/br`, {}, 5000, ["127.0.0.1"]);
    assert.match(await br.text(), /<title>brotli<\/title>/, "brotli is decompressed");
  }
  {
    // A status that cannot carry a body must not throw in the Response
    // constructor, and a redirect must still expose its location.
    const r304 = await pinnedFetch(`http://example.com:${pinPort}/304`, {}, 5000, ["127.0.0.1"]);
    assert.strictEqual(r304.status, 304);
    const moved = await pinnedFetch(`http://example.com:${pinPort}/moved`, {}, 5000, ["127.0.0.1"]);
    assert.strictEqual(moved.headers.get("location"), "/", "a redirect's location is readable, which is how safeFetch walks the chain");
  }
  {
    // No addresses means nothing to connect to, and must not fall back to DNS.
    await rejects(pinnedFetch(`http://example.com:${pinPort}/`, {}, 2000, []), "an empty pin list refuses rather than resolving");
  }
  {
    // The per-hop timeout still aborts a server that never answers.
    const stalled = http.createServer(() => {});
    await new Promise((resolve) => stalled.listen(0, "127.0.0.1", resolve));
    const started = Date.now();
    let err;
    try { await pinnedFetch(`http://example.com:${stalled.address().port}/`, {}, 800, ["127.0.0.1"]); }
    catch (e) { err = e; }
    stalled.close();
    assert.ok(err && isAbortError(err), "a stalled pinned fetch aborts as a timeout");
    assert.ok(Date.now() - started < 2500, "and aborts promptly");
  }
  pinServer.close();

  // --- The whole fetch has one budget, not one per hop ---
  // Five redirects at 9s each was 54s inside a function capped at 60. An
  // exhausted budget is reported as a timeout, before any connection is made,
  // so this needs no network.
  // --- The deadline covers reading the body, not just getting the headers ---
  // A server can answer promptly and then dribble for ever. The body is read by
  // the caller after safeFetch has returned, so a timer cleared when the
  // headers arrive would leave that unbounded.
  {
    const slowBody = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      if (req.url === "/dribble") {
        const tick = setInterval(() => { try { res.write("x"); } catch { clearInterval(tick); } }, 300);
        res.on("close", () => clearInterval(tick));
        return;
      }
      res.write("<!doctype html>"); // headers, a little body, then silence
    });
    await new Promise((resolve) => slowBody.listen(0, "127.0.0.1", resolve));
    const slowPort = slowBody.address().port;
    for (const path of ["/dribble", "/silence"]) {
      const started = Date.now();
      let err;
      try {
        const r = await pinnedFetch(`http://example.com:${slowPort}${path}`, {}, 1200, ["127.0.0.1"]);
        await readBodyCapped(r);
      } catch (e) { err = e; }
      assert.ok(err, `a stalled body (${path}) must not read for ever`);
      assert.ok(isAbortError(err), `and must surface as a timeout so the route answers 504, got ${err && err.message}`);
      assert.ok(Date.now() - started < 3000, `and must stop near the deadline (${path})`);
    }
    slowBody.close();
  }

  // --- Response-size limits survive the move off global fetch ---
  {
    const zlib = require("zlib");
    const bigServer = http.createServer((req, res) => {
      if (req.url === "/bomb") {
        // ~40 MB of one byte in ~40 KB of gzip. content-length describes the
        // COMPRESSED body and says nothing about what it expands to, which is
        // why pinnedFetch drops that header once it has decompressed.
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(zlib.gzipSync(Buffer.alloc(40 * 1024 * 1024, 0x61)));
        return;
      }
      res.writeHead(200, { "content-type": "text/html", "content-length": String(8 * 1024 * 1024) });
      res.end(Buffer.alloc(8 * 1024 * 1024, 0x62));
    });
    await new Promise((resolve) => bigServer.listen(0, "127.0.0.1", resolve));
    const bigPort = bigServer.address().port;
    const over = await pinnedFetch(`http://example.com:${bigPort}/big`, {}, 8000, ["127.0.0.1"]);
    assert.strictEqual(await readBodyCapped(over, 6000000), null, "an over-cap body is still refused");
    const bomb = await pinnedFetch(`http://example.com:${bigPort}/bomb`, {}, 8000, ["127.0.0.1"]);
    assert.strictEqual(bomb.headers.get("content-length"), null, "a decompressed body has no trustworthy declared length");
    assert.strictEqual(await readBodyCapped(bomb, 6000000), null, "and the cap bounds the DECOMPRESSED size, which content-length never could");
    bigServer.close();
  }

  {
    // totalMs=0 against a 9000ms per-hop timeout is also the regression test
    // for how this was first written: an earlier version set the deadline from
    // Math.max(timeoutMs, totalMs), which silently discarded any budget
    // smaller than one hop, and a 9s hop inside a 2s budget duly ran 9s.
    const started = Date.now();
    let err;
    try { await safeFetch("https://example.com/", {}, 9000, 5, 0); } catch (e) { err = e; }
    assert.ok(err && isAbortError(err), "an explicit budget smaller than one hop is still honoured, and reads as a timeout");
    assert.ok(Date.now() - started < 500, "and is refused before any connection, so this needs no network");
  }

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

  // --- bot-challenge / block-page detection (so blocked fetches fail cleanly
  //     to Paste Text instead of feeding the AI a near-empty challenge page) ---
  assert.strictEqual(looksBlockedPage({ title: "Just a moment...", text: "Checking your browser before accessing.", hasRecipe: false }), true, "Cloudflare 'Just a moment' is blocked");
  assert.strictEqual(looksBlockedPage({ title: "Access Denied", text: "x".repeat(2000), hasRecipe: false }), true, "explicit block marker caught even with long body");
  assert.strictEqual(looksBlockedPage({ title: "", text: "tiny stub page", hasRecipe: false }), true, "thin body (<600 chars) treated as blocked");
  assert.strictEqual(looksBlockedPage({ title: "Banana Bread", text: "x".repeat(5000), hasRecipe: false }), false, "a substantial real page is NOT blocked");
  assert.strictEqual(looksBlockedPage({ title: "Just a moment...", text: "short", hasRecipe: true }), false, "a structured recipe is never treated as blocked");

  console.log("import-reliability-test: ok");
})().catch((err) => { console.error(err); process.exit(1); });
