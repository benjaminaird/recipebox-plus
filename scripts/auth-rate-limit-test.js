const assert = require("assert");
const app = require("../server");
const { periodKey, resetAfter } = app._test;

// 15-minute auth window: key carries a 0-3 quarter suffix and the reset is the
// next quarter-hour boundary (so the DB-backed auth limiter resets promptly).
const qKey = periodKey("quarterhour");
assert.ok(/:\d$/.test(qKey), "quarterhour key has a quarter suffix: " + qKey);
const quarter = Number(qKey.split(":").pop());
assert.ok(quarter >= 0 && quarter <= 3, "quarter index is 0-3");

const qDelta = resetAfter("quarterhour").getTime() - Date.now();
assert.ok(qDelta > 0 && qDelta <= 15 * 60 * 1000 + 1000, "quarterhour resets within the next 15 min");

const hDelta = resetAfter("hour").getTime() - Date.now();
assert.ok(hDelta > 0 && hDelta <= 60 * 60 * 1000 + 1000, "hour resets within the next hour");

// Existing scopes still behave.
assert.strictEqual(periodKey("month").length, 7, "month key is YYYY-MM");
assert.strictEqual(periodKey("day").length, 10, "day key is YYYY-MM-DD");

// AI burst window (10 min) + duplicate-import window (2 min) used by /api/ai.
const tenKey = periodKey("tenminutes");
assert.ok(/:\d$/.test(tenKey), "tenminutes key has a slot suffix: " + tenKey);
const tenDelta = resetAfter("tenminutes").getTime() - Date.now();
assert.ok(tenDelta > 0 && tenDelta <= 10 * 60 * 1000 + 1000, "burst window resets within the next 10 min");
const twoDelta = resetAfter("twominutes").getTime() - Date.now();
assert.ok(twoDelta > 0 && twoDelta <= 2 * 60 * 1000 + 1000, "dedupe window resets within the next 2 min");

console.log("auth-rate-limit-test: ok");
