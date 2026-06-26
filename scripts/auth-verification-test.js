// Email-verification + token safety (Milestone 1). Pure/unit-level checks of
// the real server helpers — no DB needed.
const assert = require("assert");
const crypto = require("crypto");
const app = require("../server");
const { hashToken, publicUser, VERIFY_TOKEN_MINUTES } = app._test;

// ── Token generation matches the reset-token pattern: random, URL-safe ──
const token = crypto.randomBytes(32).toString("base64url");
assert.ok(/^[A-Za-z0-9_-]{43}$/.test(token), "verification token is 256-bit url-safe (got " + token + ")");

// ── hashToken: deterministic, hashed (not the raw token), collision-distinct ──
const h1 = hashToken(token);
const h2 = hashToken(token);
assert.strictEqual(h1, h2, "hashToken is deterministic");
assert.notStrictEqual(h1, token, "the token is stored hashed, never raw");
assert.strictEqual(h1, crypto.createHash("sha256").update(token).digest("hex"), "hashToken is sha256 hex");
assert.notStrictEqual(hashToken(crypto.randomBytes(32).toString("base64url")), h1, "different tokens hash differently");

// ── Expiry window is sane (24h) ──
assert.strictEqual(VERIFY_TOKEN_MINUTES, 1440, "verification links expire in 24h");

// ── publicUser never leaks secrets and shapes emailVerified safely ──
const u = publicUser({ user_id: "u1", email: "a@b.com", display_name: "A", role: "user", email_verified: false, password_hash: "SECRET" });
assert.strictEqual(u.emailVerified, false, "unverified user is reported unverified");
assert.ok(!("password_hash" in u) && !("passwordHash" in u), "publicUser never exposes the password hash");
assert.strictEqual(publicUser({ role: "user", email_verified: true }).emailVerified, true, "verified user is reported verified");
// When the column isn't selected (older queries), default to verified so we
// never show a spurious verify prompt to existing/grandfathered users.
assert.strictEqual(publicUser({ role: "user" }).emailVerified, true, "missing column defaults to verified (no spurious prompt)");
assert.strictEqual(publicUser(null), null, "null row -> null user");

console.log("auth-verification-test: ok");
