// Server-side hardening from the red-team pass: AI body clamp + email-link
// host-header injection fix. Pure/unit checks — no DB/network.
const assert = require("assert");
const app = require("../server");
const { sanitizeAiBody, trustedAppOrigin, ALLOWED_AI_MODELS, DEFAULT_AI_MODEL, MAX_AI_OUTPUT_TOKENS } = app._test;

// ── AI body clamp: client cannot force an expensive model or huge output ──
assert.strictEqual(sanitizeAiBody({ model: "claude-opus-4-8", max_tokens: 4000 }).model, DEFAULT_AI_MODEL, "non-allowlisted model is coerced to the default");
assert.strictEqual(sanitizeAiBody({ model: "claude-sonnet-4-5-20250929" }).model, "claude-sonnet-4-5-20250929", "allowlisted model is kept");
assert.ok(ALLOWED_AI_MODELS.has(DEFAULT_AI_MODEL), "default model is on the allowlist");
assert.strictEqual(sanitizeAiBody({ max_tokens: 999999 }).max_tokens, MAX_AI_OUTPUT_TOKENS, "max_tokens is capped");
assert.strictEqual(sanitizeAiBody({ max_tokens: -5 }).max_tokens, 1, "max_tokens floored to >=1");
assert.strictEqual(sanitizeAiBody({}).max_tokens, 4096, "missing max_tokens -> sane default");
assert.strictEqual(sanitizeAiBody({ model: "evil", max_tokens: "8000" }).max_tokens, 8000, "numeric-string tokens parsed + within cap");
// Other fields (messages/system) pass through untouched so legit calls work.
assert.deepStrictEqual(sanitizeAiBody({ model: "x", messages: [{ role: "user", content: "hi" }] }).messages, [{ role: "user", content: "hi" }]);
assert.deepStrictEqual(sanitizeAiBody(null), { model: DEFAULT_AI_MODEL, max_tokens: 4096 }, "null body -> safe defaults");

// ── Email-link origin must NOT trust an attacker-controlled Host header ──
const spoof = (host) => trustedAppOrigin({ headers: { host, "x-forwarded-host": host, "x-forwarded-proto": "https" }, protocol: "https" });
const PROD = "https://recipebox-kappa.vercel.app";
if (!process.env.APP_BASE_URL) {
  assert.strictEqual(spoof("evil.example.com"), PROD, "spoofed Host is ignored (pinned to prod origin)");
  assert.strictEqual(spoof("attacker.com:8443"), PROD, "spoofed Host:port is ignored");
  assert.strictEqual(spoof("localhost:3000"), "https://localhost:3000", "localhost is honoured for dev");
  assert.strictEqual(spoof("127.0.0.1:3000"), "https://127.0.0.1:3000", "loopback honoured for dev");
} else {
  assert.strictEqual(spoof("evil.example.com"), process.env.APP_BASE_URL.replace(/\/$/, ""), "APP_BASE_URL wins over any Host");
}

console.log("security-hardening-test: ok");
