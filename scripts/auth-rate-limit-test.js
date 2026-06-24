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

console.log("auth-rate-limit-test: ok");
