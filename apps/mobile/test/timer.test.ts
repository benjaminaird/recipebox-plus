// Timers. Every case drives the clock by hand, so "what happens after four
// hours asleep" is a test rather than an afternoon.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  adjustTimer, byUrgency, createTimer, durationLabel, durationsInText,
  formatRemaining, hasElapsed, pauseTimer, QUICK_DURATIONS_MS, remainingMs,
  restartTimer, resumeTimer, settle, type Timer,
} from "../src/domain/timer.ts";

const T0 = 1_700_000_000_000;
const MIN = 60_000;

const make = (overrides: Partial<Parameters<typeof createTimer>[0]> = {}) =>
  createTimer({ label: "Caramel", durationMs: 10 * MIN, now: T0, ...overrides });

test("a new timer runs against an absolute deadline", () => {
  const t = make();
  assert.equal(t.status, "running");
  assert.equal(t.endsAt, T0 + 10 * MIN);
  assert.equal(t.remainingMs, null, "a running timer holds no countdown of its own");
  assert.equal(remainingMs(t, T0), 10 * MIN);
});

test("time passing is a subtraction, not a tick count", () => {
  const t = make();
  assert.equal(remainingMs(t, T0 + 4 * MIN), 6 * MIN);
  // The app being closed for the whole duration changes nothing.
  assert.equal(remainingMs(t, T0 + 10 * MIN), 0);
  assert.equal(remainingMs(t, T0 + 99 * MIN), 0, "never negative");
});

test("a timer that elapsed while the app was closed is already finished", () => {
  // The case that motivates absolute deadlines: launch four hours later.
  const t = make();
  assert.equal(hasElapsed(t, T0 + 4 * 3600_000), true);
  const settled = settle(t, T0 + 4 * 3600_000);
  assert.equal(settled.status, "done");
  assert.equal(remainingMs(settled, T0 + 4 * 3600_000), 0);
});

test("settling an unfinished timer leaves it alone", () => {
  const t = make();
  assert.equal(settle(t, T0 + MIN), t);
  assert.equal(settle(pauseTimer(t, T0 + MIN), T0 + 99 * MIN).status, "paused",
    "a paused timer cannot elapse");
});

test("pause freezes what is left, and resume starts from there", () => {
  const t = make();
  const paused = pauseTimer(t, T0 + 3 * MIN);
  assert.equal(paused.status, "paused");
  assert.equal(paused.remainingMs, 7 * MIN);
  assert.equal(paused.endsAt, null, "a paused timer has no deadline");

  // An hour on the counter does not consume the remaining seven minutes.
  assert.equal(remainingMs(paused, T0 + 63 * MIN), 7 * MIN);

  const resumed = resumeTimer(paused, T0 + 63 * MIN);
  assert.equal(resumed.status, "running");
  assert.equal(resumed.endsAt, T0 + 70 * MIN);
  assert.equal(remainingMs(resumed, T0 + 63 * MIN), 7 * MIN);
});

test("pause and resume are no-ops in the wrong state", () => {
  const t = make();
  assert.equal(resumeTimer(t, T0), t, "already running");
  const paused = pauseTimer(t, T0);
  assert.equal(pauseTimer(paused, T0), paused, "already paused");
});

test("resuming a timer with nothing left finishes it", () => {
  // Rather than starting a timer that fires instantly.
  const spent: Timer = { ...make(), status: "paused", remainingMs: 0, endsAt: null };
  const resumed = resumeTimer(spent, T0 + MIN);
  assert.equal(resumed.status, "done");
});

test("a finished timer can be run again for its original duration", () => {
  const done = settle(make(), T0 + 20 * MIN);
  const again = restartTimer(done, T0 + 30 * MIN);
  assert.equal(again.status, "running");
  assert.equal(again.endsAt, T0 + 40 * MIN);
  assert.equal(again.durationMs, 10 * MIN, "the original duration is kept");
});

test("time can be added or taken off, and never goes below zero", () => {
  const t = make();
  assert.equal(remainingMs(adjustTimer(t, 5 * MIN, T0), T0), 15 * MIN);
  assert.equal(remainingMs(adjustTimer(t, -5 * MIN, T0), T0), 5 * MIN);
  assert.equal(remainingMs(adjustTimer(t, -99 * MIN, T0), T0), 0);

  const paused = pauseTimer(t, T0 + 2 * MIN);
  const adjusted = adjustTimer(paused, MIN, T0 + 2 * MIN);
  assert.equal(adjusted.status, "paused", "adjusting does not resume");
  assert.equal(adjusted.remainingMs, 9 * MIN);
});

test("timers sort by what needs attention soonest", () => {
  const now = T0 + MIN;
  const running5 = createTimer({ label: "a", durationMs: 5 * MIN, now: T0 });
  const running2 = createTimer({ label: "b", durationMs: 2 * MIN, now: T0 });
  const paused = pauseTimer(createTimer({ label: "c", durationMs: 9 * MIN, now: T0 }), T0);
  const done = settle(createTimer({ label: "d", durationMs: 0, now: T0 }), now);

  const sorted = [paused, running5, done, running2].sort(byUrgency(now)).map((t) => t.label);
  assert.deepEqual(sorted, ["d", "b", "a", "c"],
    "finished first, then running by time left, paused last");
});

test("remaining time is formatted at a constant width", () => {
  assert.equal(formatRemaining(0), "0:00");
  assert.equal(formatRemaining(9_000), "0:09");
  assert.equal(formatRemaining(59_000), "0:59");
  assert.equal(formatRemaining(60_000), "1:00");
  assert.equal(formatRemaining(599_000), "9:59");
  assert.equal(formatRemaining(3_600_000), "1:00:00");
  assert.equal(formatRemaining(3_723_000), "1:02:03");
  assert.equal(formatRemaining(-5), "0:00", "never shows a negative");
});

test("a part-second rounds up, so a timer never shows 0:00 while running", () => {
  assert.equal(formatRemaining(1), "0:01");
  assert.equal(formatRemaining(1_500), "0:02");
});

test("quick durations are sensible and labelled", () => {
  assert.ok(QUICK_DURATIONS_MS.every((ms) => ms > 0));
  assert.equal(durationLabel(60_000), "1 min");
  assert.equal(durationLabel(30 * MIN), "30 min");
  assert.equal(durationLabel(3_600_000), "1 hr");
  assert.equal(durationLabel(90 * MIN), "1.5 hr");
});

// ---------------------------------------------------------------------------
// Offering a timer for what a step actually says
// ---------------------------------------------------------------------------

test("durations are read out of step text", () => {
  assert.deepEqual(durationsInText("Simmer 15 minutes."), [15 * MIN]);
  assert.deepEqual(durationsInText("Bake at 180C for 11-12 minutes"), [12 * MIN]);
  assert.deepEqual(durationsInText("Chill for 3 hours"), [3 * 3600_000]);
  assert.deepEqual(durationsInText("Rest 30 seconds"), [30_000]);
});

test("a range takes its longer end", () => {
  // A timer that goes off early prompts a check; one that goes off late is a
  // burnt dish.
  assert.deepEqual(durationsInText("cook 8 to 10 mins"), [10 * MIN]);
});

test("several durations in one step all become offers", () => {
  const found = durationsInText("Fry 2 minutes a side, then rest 5 minutes.");
  assert.deepEqual(found, [2 * MIN, 5 * MIN]);
});

test("numbers that are not durations are ignored", () => {
  assert.deepEqual(durationsInText("Heat the oven to 180C and use a 20cm tin."), []);
  assert.deepEqual(durationsInText("Add 2 eggs and 150 g sugar."), []);
  assert.deepEqual(durationsInText(""), []);
});

test("the real sample steps yield the timers a cook would want", () => {
  assert.deepEqual(
    durationsInText("Scoop onto lined trays and bake at 180C for 11-12 minutes, until the edges are set."),
    [12 * MIN],
  );
});
