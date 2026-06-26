// Locks in the production security headers in vercel.json (Milestone 2).
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const v = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
const block = (v.headers || []).find((h) => h.source === "/(.*)");
assert.ok(block, "global header block exists");
const byKey = Object.fromEntries(block.headers.map((h) => [h.key.toLowerCase(), h.value]));

// Headers that must be present and enforced.
assert.strictEqual(byKey["x-content-type-options"], "nosniff");
assert.strictEqual(byKey["x-frame-options"], "DENY");
assert.ok(/strict-origin/.test(byKey["referrer-policy"] || ""), "referrer policy set");
assert.ok(/payment=\(\)/.test(byKey["permissions-policy"] || ""), "permissions policy locks down payment");
assert.ok(/max-age=\d{7,}/.test(byKey["strict-transport-security"] || ""), "HSTS with a long max-age");
assert.ok(/same-origin/.test(byKey["cross-origin-opener-policy"] || ""), "COOP set");

// CSP is shipped report-only first; it must include the real CDN/font sources
// the app uses so promotion to enforce won't break anything.
const csp = byKey["content-security-policy-report-only"] || byKey["content-security-policy"] || "";
assert.ok(csp, "a CSP (report-only or enforced) is present");
for (const needle of [
  "default-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "https://cdnjs.cloudflare.com", // pdf.js worker + jspdf
  "https://unpkg.com",            // react
  "https://cdn.jsdelivr.net",     // heic2any
  "https://fonts.gstatic.com",    // font files
  "img-src 'self' data: blob: https:", // recipe images from anywhere
  "worker-src",
  "connect-src 'self'",
]) {
  assert.ok(csp.includes(needle), "CSP includes: " + needle);
}
// connect-src must NOT be wide-open https: (API is same-origin; AI is proxied).
assert.ok(!/connect-src[^;]*\bhttps:(?!\/\/)/.test(csp), "connect-src is not a blanket https:");

console.log("security-headers-test: ok");
