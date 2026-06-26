/*
 * Offline tests for the bot-block scraping-proxy fallback (no network, no key,
 * no credits burned). Covers the ScraperAPI request builder and the shared
 * page-result builder (deterministic extraction + blocked flag) that the
 * fallback reuses on the proxied HTML.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const app = require("../server");
const { scraperRequestUrl, jinaRequestUrl, buildPageResult } = app._test;

// ── Jina Reader request URL (default, free provider) ──
const jurl = jinaRequestUrl("https://www.allrecipes.com/recipe/20144/banana-banana-bread/");
assert.strictEqual(jurl, "https://r.jina.ai/https://www.allrecipes.com/recipe/20144/banana-banana-bread/", "Jina takes the full target URL appended to its host");
assert.ok(jurl.startsWith("https://r.jina.ai/"), "calls the fixed trusted Jina host");

// ── ScraperAPI request URL builder (optional paid provider) ──
const u = new URL(scraperRequestUrl("https://www.allrecipes.com/recipe/20144/banana-banana-bread/", { key: "K123", tier: "premium" }));
assert.strictEqual(u.origin + u.pathname, "https://api.scraperapi.com/", "calls the fixed trusted ScraperAPI host");
assert.strictEqual(u.searchParams.get("api_key"), "K123", "passes the api key");
assert.strictEqual(u.searchParams.get("url"), "https://www.allrecipes.com/recipe/20144/banana-banana-bread/", "passes (and URL-encodes) the target");
assert.strictEqual(u.searchParams.get("render"), "false", "no JS render — JSON-LD is in the server HTML");
assert.strictEqual(u.searchParams.get("premium"), "true", "premium proxy for hard anti-bot sites");
const ultra = new URL(scraperRequestUrl("https://example.com/r", { key: "K", tier: "ultra" }));
assert.strictEqual(ultra.searchParams.get("ultra_premium"), "true", "ultra tier sets ultra_premium");
const std = new URL(scraperRequestUrl("https://example.com/r", { key: "K", tier: "standard" }));
assert.strictEqual(std.searchParams.get("premium"), null, "standard tier uses no premium proxy");

// ── buildPageResult: the fallback reuses this on the proxied HTML ──
// A real structured page -> recipe extracted, not blocked.
const goodHtml = fs.readFileSync(path.join(__dirname, "import-test", "fixtures", "jsonld-wprm.html"), "utf8");
const good = buildPageResult(goodHtml, "https://example.com/cookies", "https://example.com/cookies");
assert.strictEqual(good.blocked, false, "a structured page is not blocked");
assert.ok(good.recipe && good.recipe.title === "Brown Butter Chocolate Chip Cookies", "recipe extracted from proxied HTML");
assert.strictEqual(good.extractSource, "jsonld");
assert.ok(good.htmlHash && good.htmlHash.length === 64, "stable html hash returned");

// A Cloudflare-style challenge stub -> blocked, no recipe (so the route 422s or
// the proxy retry kicks in).
const blockedHtml = "<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser before accessing the site. Enable JavaScript.</body></html>";
const blocked = buildPageResult(blockedHtml, "https://www.allrecipes.com/x", "https://www.allrecipes.com/x");
assert.strictEqual(blocked.blocked, true, "challenge stub is flagged blocked");
assert.strictEqual(blocked.recipe, null, "no recipe from a challenge stub");

console.log("scraper-fallback-test: ok");
