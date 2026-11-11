// Meal planning rules.
//
// The date tests carry most of the weight. A planner's worst bug is a meal
// that moves to the wrong day, and every way that happens is a timezone or a
// daylight-saving edge rather than anything a cook can see coming.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MEAL_SLOTS, addDays, dayLabel, daysBetween, fromDateKey, isDateKey, mealCounts,
  mealsBySlot, mealsInRange, monthLabel, nextPosition, parseScale, parseSlot,
  startOfWeek, toDateKey, weekOf, weekdayShort, type PlannedMeal,
} from "../src/domain/plan.ts";

const meal = (over: Partial<PlannedMeal> = {}): PlannedMeal => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  date: "2026-03-17",
  slot: "dinner",
  recipeId: "r1",
  scale: 1,
  position: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test("a date key is the LOCAL calendar date, not the UTC one", () => {
  // 23:30 on the 17th, local. toISOString() would call this the 18th anywhere
  // west of Greenwich, which would file the evening's dinner under tomorrow.
  const lateEvening = new Date(2026, 2, 17, 23, 30, 0);
  assert.equal(toDateKey(lateEvening), "2026-03-17");

  const earlyMorning = new Date(2026, 2, 17, 0, 15, 0);
  assert.equal(toDateKey(earlyMorning), "2026-03-17");
});

test("a date key round-trips", () => {
  for (const key of ["2026-01-01", "2026-03-17", "2026-12-31", "2024-02-29"]) {
    assert.equal(toDateKey(fromDateKey(key)), key, key);
  }
});

test("date arithmetic survives a daylight-saving change", () => {
  // In most of Europe the clocks go forward on the last Sunday of March 2026
  // (29th) and back on the last Sunday of October (25th). A day's arithmetic
  // done from midnight lands on the wrong date across those boundaries; done
  // from midday it does not.
  assert.equal(addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addDays("2026-03-29", 1), "2026-03-30");
  assert.equal(addDays("2026-10-24", 1), "2026-10-25");
  assert.equal(addDays("2026-10-25", 1), "2026-10-26");

  // And in the US, where the dates differ (8 March and 1 November 2026).
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-11-01", 1), "2026-11-02");

  // A whole week of single steps must equal one seven-day step, across the
  // spring boundary in both hemispheres' conventions.
  let walked = "2026-03-25";
  for (let i = 0; i < 7; i += 1) walked = addDays(walked, 1);
  assert.equal(walked, addDays("2026-03-25", 7));
  assert.equal(walked, "2026-04-01");
});

test("date arithmetic crosses months and years", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  // A leap year, and the year after it.
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2025-02-28", 1), "2025-03-01");
});

test("daysBetween is signed and symmetric", () => {
  assert.equal(daysBetween("2026-03-17", "2026-03-20"), 3);
  assert.equal(daysBetween("2026-03-20", "2026-03-17"), -3);
  assert.equal(daysBetween("2026-03-17", "2026-03-17"), 0);
  // Across a DST boundary it is still a whole number of days.
  assert.equal(daysBetween("2026-03-25", "2026-04-01"), 7);
  assert.equal(daysBetween("2026-10-20", "2026-10-27"), 7);
});

test("a week runs Monday to Sunday and always has seven dates", () => {
  // 17 March 2026 is a Tuesday.
  assert.equal(weekdayShort("2026-03-17"), "Tue");
  assert.equal(startOfWeek("2026-03-17"), "2026-03-16");

  const week = weekOf("2026-03-17");
  assert.equal(week.length, 7);
  assert.equal(week[0], "2026-03-16");
  assert.equal(week[6], "2026-03-22");
  assert.equal(weekdayShort(week[0]), "Mon");
  assert.equal(weekdayShort(week[6]), "Sun");

  // A Sunday belongs to the week that is ending, not the one starting.
  assert.equal(startOfWeek("2026-03-22"), "2026-03-16");
  // A Monday is its own start.
  assert.equal(startOfWeek("2026-03-16"), "2026-03-16");
  // And a week spanning a DST change still has seven distinct dates.
  const dst = weekOf("2026-03-29");
  assert.equal(new Set(dst).size, 7);
});

test("a date key is validated on read", () => {
  assert.equal(isDateKey("2026-03-17"), true);
  for (const junk of ["", "2026-3-17", "17/03/2026", "tomorrow", null, 20260317, {}]) {
    assert.equal(isDateKey(junk), false, String(junk));
  }
});

test("day and month labels say something a cook can act on", () => {
  assert.equal(dayLabel("2026-03-17", "2026-03-17"), "Today");
  assert.equal(dayLabel("2026-03-18", "2026-03-17"), "Tomorrow");
  assert.equal(dayLabel("2026-03-16", "2026-03-17"), "Yesterday");
  // Beyond a day, a weekday name beats a relative count.
  assert.equal(dayLabel("2026-03-20", "2026-03-17"), "Friday 20 Mar");

  assert.equal(monthLabel("2026-03-16", "2026-03-22"), "March 2026");
  assert.equal(monthLabel("2026-03-30", "2026-04-05"), "March – April 2026");
  assert.equal(monthLabel("2026-12-28", "2027-01-03"), "December 2026 – January 2027");
});

// ---------------------------------------------------------------------------
// Arranging
// ---------------------------------------------------------------------------

test("a day's meals group by slot in the order they are eaten", () => {
  const meals = [
    meal({ id: "d", slot: "dinner", position: 0 }),
    meal({ id: "b", slot: "breakfast", position: 0 }),
    meal({ id: "d2", slot: "dinner", position: 1 }),
    meal({ id: "x", date: "2026-03-18", slot: "lunch" }),
  ];
  const grouped = mealsBySlot(meals, "2026-03-17");
  assert.deepEqual(grouped.breakfast.map((m) => m.id), ["b"]);
  assert.deepEqual(grouped.lunch.map((m) => m.id), []);
  assert.deepEqual(grouped.dinner.map((m) => m.id), ["d", "d2"]);
  assert.deepEqual(grouped.other.map((m) => m.id), []);
  // Every slot is present even when empty, so the screen never has to guess.
  for (const slot of MEAL_SLOTS) assert.ok(Array.isArray(grouped[slot]));
});

test("two meals in one slot keep the order they were added", () => {
  const meals = [
    meal({ id: "second", position: 1, createdAt: 10 }),
    meal({ id: "first", position: 0, createdAt: 20 }),
  ];
  assert.deepEqual(mealsBySlot(meals, "2026-03-17").dinner.map((m) => m.id), ["first", "second"]);
});

test("a new meal lands at the end of its slot, not on top of another", () => {
  const meals = [meal({ position: 0 }), meal({ position: 1 })];
  assert.equal(nextPosition(meals, "2026-03-17", "dinner"), 2);
  // A different slot, and a different day, each start at zero.
  assert.equal(nextPosition(meals, "2026-03-17", "lunch"), 0);
  assert.equal(nextPosition(meals, "2026-03-18", "dinner"), 0);
  assert.equal(nextPosition([], "2026-03-17", "dinner"), 0);
});

test("counts per day mark which days have something planned", () => {
  const counts = mealCounts([
    meal({ date: "2026-03-17" }),
    meal({ date: "2026-03-17", slot: "lunch" }),
    meal({ date: "2026-03-19" }),
  ]);
  assert.equal(counts["2026-03-17"], 2);
  assert.equal(counts["2026-03-19"], 1);
  assert.equal(counts["2026-03-18"], undefined);
});

test("a date range is inclusive at both ends and comes back in cooking order", () => {
  const meals = [
    meal({ id: "wed-dinner", date: "2026-03-18", slot: "dinner" }),
    meal({ id: "tue-breakfast", date: "2026-03-17", slot: "breakfast" }),
    meal({ id: "tue-dinner", date: "2026-03-17", slot: "dinner" }),
    meal({ id: "outside", date: "2026-03-25" }),
  ];
  assert.deepEqual(
    mealsInRange(meals, "2026-03-17", "2026-03-18").map((m) => m.id),
    ["tue-breakfast", "tue-dinner", "wed-dinner"],
  );
  // One day is a range of one.
  assert.deepEqual(mealsInRange(meals, "2026-03-17", "2026-03-17").map((m) => m.id).length, 2);
  // Reversed bounds are a user error, not an empty week.
  assert.equal(mealsInRange(meals, "2026-03-18", "2026-03-17").length, 3);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("a slot is validated on read", () => {
  assert.equal(parseSlot("breakfast"), "breakfast");
  assert.equal(parseSlot("other"), "other");
  // Anything unknown lands on dinner, the slot most meals belong to, rather
  // than on a value the screen has no section for.
  for (const junk of ["brunch", "", null, undefined, 3, {}]) {
    assert.equal(parseSlot(junk), "dinner", String(junk));
  }
});

test("a planned scale is validated on read", () => {
  assert.equal(parseScale(2), 2);
  assert.equal(parseScale(0.5), 0.5);
  for (const junk of [0, -1, 1.5, 7, "2", null, undefined, NaN, {}]) {
    assert.equal(parseScale(junk), 1, String(junk));
  }
});
