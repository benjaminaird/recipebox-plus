// Meal planning: slots, calendar dates, and the rules for arranging meals.
//
// Pure. No React Native, no DOM, no database.
//
// ## Dates are calendar days, not instants
//
// A meal is planned for Tuesday. It is not planned for 00:00 UTC on Tuesday,
// and it must still be Tuesday's dinner after the cook flies to another
// timezone or the clocks change. Storing an epoch would let a planned meal slide
// into the previous day, so dates are `YYYY-MM-DD` strings throughout and the
// only place a Date object appears is at the boundary where one is formatted.
//
// ## Slots exist because ADR 0006 says they do
//
// The sync policy specifies merge "last-write-wins per day-and-meal slot", so a
// slot is a first-class part of the model even though the production web app's
// storage has none yet. See docs/native-overnight-progress.md.

/** A calendar date as `YYYY-MM-DD`. Never an instant. */
export type DateKey = string;

export type MealSlot = "breakfast" | "lunch" | "dinner" | "other";

/** Display order. A day reads top to bottom in the order it is eaten. */
export const MEAL_SLOTS: readonly MealSlot[] = ["breakfast", "lunch", "dinner", "other"];

export const SLOT_LABELS: Readonly<Record<MealSlot, string>> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  // Not "Snack": a Sunday afternoon's baking is not a snack, and neither is
  // prepping a sauce for later. "Other" claims less and is wrong less often.
  other: "Other",
};

export function parseSlot(value: unknown): MealSlot {
  return MEAL_SLOTS.includes(value as MealSlot) ? (value as MealSlot) : "dinner";
}

/** One planned meal. `scale` is the batch it is planned at, which the shopping
 *  list later reads; it is a property of the plan, not of the recipe. */
export type PlannedMeal = {
  id: string;
  date: DateKey;
  slot: MealSlot;
  recipeId: string;
  scale: number;
  /** Order within a slot, so two dinners keep the order they were added. */
  position: number;
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Calendar arithmetic
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The local calendar date of a Date, as `YYYY-MM-DD`. Local, deliberately:
 *  toISOString() would give the UTC date, which is the previous day for most of
 *  the evening in the Americas. */
export function toDateKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Midday, not midnight. Arithmetic from noon survives a daylight-saving shift
 *  in either direction without landing on the previous or next day. */
export function fromDateKey(key: DateKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

export function isDateKey(value: unknown): value is DateKey {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = fromDateKey(key);
  return toDateKey(new Date(d.getTime() + days * DAY_MS));
}

export function daysBetween(a: DateKey, b: DateKey): number {
  return Math.round((fromDateKey(b).getTime() - fromDateKey(a).getTime()) / DAY_MS);
}

/** Monday. The project is written in British English and plans a week as
 *  Monday to Sunday; a cook planning "this week" on a Sunday means the week
 *  that is ending, not the one about to start. */
export const WEEK_STARTS_ON = 1;

export function startOfWeek(key: DateKey, weekStartsOn: number = WEEK_STARTS_ON): DateKey {
  const d = fromDateKey(key);
  const shift = (d.getDay() - weekStartsOn + 7) % 7;
  return addDays(key, -shift);
}

/** The seven dates of the week containing `key`. */
export function weekOf(key: DateKey, weekStartsOn: number = WEEK_STARTS_ON): DateKey[] {
  const start = startOfWeek(key, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_INITIAL = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function weekdayShort(key: DateKey): string {
  return WEEKDAY_SHORT[fromDateKey(key).getDay()];
}

export function weekdayInitial(key: DateKey): string {
  return WEEKDAY_INITIAL[fromDateKey(key).getDay()];
}

export function dayOfMonth(key: DateKey): number {
  return fromDateKey(key).getDate();
}

/** "March 2026", or "March – April 2026" when a week straddles two months. */
export function monthLabel(from: DateKey, to: DateKey = from): string {
  const a = fromDateKey(from);
  const b = fromDateKey(to);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameMonth) return `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  if (a.getFullYear() === b.getFullYear()) {
    return `${MONTHS[a.getMonth()]} – ${MONTHS[b.getMonth()]} ${a.getFullYear()}`;
  }
  return `${MONTHS[a.getMonth()]} ${a.getFullYear()} – ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
}

/** "Today", "Tomorrow", "Yesterday", else "Tuesday 17 March". Relative names
 *  only within a day of now, because "in 3 days" is harder to act on than a
 *  weekday name a cook can see on a calendar. */
export function dayLabel(key: DateKey, today: DateKey): string {
  const diff = daysBetween(today, key);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = fromDateKey(key);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
  return `${weekday} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

// ---------------------------------------------------------------------------
// Arranging meals
// ---------------------------------------------------------------------------

/** Meals for one date, grouped by slot and in position order within each. */
export function mealsBySlot(
  meals: readonly PlannedMeal[],
  date: DateKey,
): Record<MealSlot, PlannedMeal[]> {
  const out = { breakfast: [], lunch: [], dinner: [], other: [] } as Record<MealSlot, PlannedMeal[]>;
  for (const m of meals) {
    if (m.date !== date) continue;
    out[m.slot].push(m);
  }
  for (const slot of MEAL_SLOTS) out[slot].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
  return out;
}

/** How many meals each date has, for marking days in a week strip. */
export function mealCounts(meals: readonly PlannedMeal[]): Record<DateKey, number> {
  const out: Record<DateKey, number> = {};
  for (const m of meals) out[m.date] = (out[m.date] ?? 0) + 1;
  return out;
}

/** The next free position in a slot, so a new meal lands at the end. */
export function nextPosition(meals: readonly PlannedMeal[], date: DateKey, slot: MealSlot): number {
  let max = -1;
  for (const m of meals) {
    if (m.date === date && m.slot === slot && m.position > max) max = m.position;
  }
  return max + 1;
}

/** Every meal in a date range, inclusive, in calendar then slot order. This is
 *  what the shopping list is generated from. */
export function mealsInRange(
  meals: readonly PlannedMeal[],
  from: DateKey,
  to: DateKey,
): PlannedMeal[] {
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  // String comparison is correct for YYYY-MM-DD and avoids parsing every row.
  return meals
    .filter((m) => m.date >= lo && m.date <= hi)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot) ||
        a.position - b.position,
    );
}

/** The batch a planned meal is cooked at. Validated on read: a stored scale
 *  from a later version, or a corrupted row, must not reach the arithmetic. */
export const PLAN_SCALES: readonly number[] = [0.5, 1, 2, 3, 4];

export function parseScale(value: unknown): number {
  return typeof value === "number" && PLAN_SCALES.includes(value) ? value : 1;
}
