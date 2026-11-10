// Kitchen timers.
//
// Pure. No React Native, no DOM, no clock of its own -- `now` is always passed
// in, which is what makes every case below testable without waiting.
//
// A running timer is stored as an absolute deadline, never as a countdown.
// JavaScript intervals stop when the app is backgrounded or the screen locks,
// so a timer built on "subtract one second each tick" silently runs slow and a
// cook returns to find it says four minutes left when the dish burned two
// minutes ago. With a deadline, elapsed time is a subtraction against the
// clock and being asleep costs nothing.
//
// The same property is what lets a timer survive a restart: the deadline is
// still in the future, or it is not, and either way the answer is correct
// without the app having been awake to count.

export type TimerStatus = "running" | "paused" | "done";

export type Timer = {
  id: string;
  /** What the cook called it: "Caramel", "Step 4". */
  label: string;
  /** What was originally asked for, so a finished timer can be restarted. */
  durationMs: number;
  /** Absolute epoch ms. Set while running, null while paused. */
  endsAt: number | null;
  /** Time left when paused. Set while paused, null while running. */
  remainingMs: number | null;
  status: TimerStatus;
  /** Set when the timer belongs to a recipe rather than standing alone. */
  recipeId?: string;
  /** Set when it belongs to a particular step of that recipe. */
  stepIndex?: number;
  createdAt: number;
};

export type NewTimer = {
  label: string;
  durationMs: number;
  now: number;
  id?: string;
  recipeId?: string;
  stepIndex?: number;
};

/** Collision-resistant without pulling in a uuid dependency. */
function newId(now: number): string {
  return `t${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createTimer({ label, durationMs, now, id, recipeId, stepIndex }: NewTimer): Timer {
  const duration = Math.max(0, Math.round(durationMs));
  return {
    id: id ?? newId(now),
    label: label.trim() || "Timer",
    durationMs: duration,
    endsAt: now + duration,
    remainingMs: null,
    status: "running",
    ...(recipeId ? { recipeId } : {}),
    ...(stepIndex !== undefined ? { stepIndex } : {}),
    createdAt: now,
  };
}

/** Milliseconds left, never negative. */
export function remainingMs(timer: Timer, now: number): number {
  if (timer.status === "done") return 0;
  if (timer.status === "paused") return Math.max(0, timer.remainingMs ?? 0);
  return Math.max(0, (timer.endsAt ?? now) - now);
}

export function hasElapsed(timer: Timer, now: number): boolean {
  return timer.status === "running" && (timer.endsAt ?? Infinity) <= now;
}

/**
 * Bring a timer up to date with the clock.
 *
 * Called on every tick and, importantly, on every app launch: a timer whose
 * deadline passed while the app was closed is already finished, and must say
 * so rather than appearing to still be running.
 */
export function settle(timer: Timer, now: number): Timer {
  if (hasElapsed(timer, now)) {
    return { ...timer, status: "done", endsAt: timer.endsAt, remainingMs: 0 };
  }
  return timer;
}

export function pauseTimer(timer: Timer, now: number): Timer {
  if (timer.status !== "running") return timer;
  return {
    ...timer,
    status: "paused",
    remainingMs: remainingMs(timer, now),
    endsAt: null,
  };
}

export function resumeTimer(timer: Timer, now: number): Timer {
  if (timer.status !== "paused") return timer;
  const left = Math.max(0, timer.remainingMs ?? 0);
  // Resuming with nothing left finishes it rather than starting a timer that
  // fires immediately.
  if (left === 0) return { ...timer, status: "done", remainingMs: 0, endsAt: null };
  return { ...timer, status: "running", endsAt: now + left, remainingMs: null };
}

/** Run the same duration again, from now. */
export function restartTimer(timer: Timer, now: number): Timer {
  return { ...timer, status: "running", endsAt: now + timer.durationMs, remainingMs: null };
}

/** Add or remove time while running or paused. Never goes below zero. */
export function adjustTimer(timer: Timer, deltaMs: number, now: number): Timer {
  if (timer.status === "done") return timer;
  const left = Math.max(0, remainingMs(timer, now) + deltaMs);
  if (timer.status === "paused") return { ...timer, remainingMs: left };
  return { ...timer, endsAt: now + left };
}

/**
 * Sort order for a list of timers: whatever needs attention soonest.
 *
 * Finished timers lead, because a timer that has gone off is the most urgent
 * thing on the screen; then running ones by how little is left; paused ones
 * last, since nothing is happening to them.
 */
export function byUrgency(now: number) {
  const rank = (t: Timer) => (t.status === "done" ? 0 : t.status === "running" ? 1 : 2);
  return (a: Timer, b: Timer): number => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) return remainingMs(a, now) - remainingMs(b, now);
    return a.createdAt - b.createdAt;
  };
}

/** "9:59", "1:02:03". Always at least mm:ss so the width does not jump. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Durations a kitchen actually uses, for one-tap timers. */
export const QUICK_DURATIONS_MS: ReadonlyArray<number> = [
  60_000, 3 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000,
];

export function durationLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
}

/**
 * Durations mentioned in a step's text, so Cook Mode can offer a timer for
 * what the step actually says rather than making the cook type it.
 *
 * Deliberately conservative: only explicit units are read, and a range takes
 * its longer end, because a timer that goes off early is a prompt to check
 * while one that goes off late is a burnt dish.
 */
export function durationsInText(text: string): number[] {
  const out: number[] = [];
  const pattern = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const value = Number(m[2] ?? m[1]); // the longer end of a range
    const unit = m[3].toLowerCase();
    const factor = unit.startsWith("h") ? 3_600_000 : unit.startsWith("m") ? 60_000 : 1000;
    const ms = Math.round(value * factor);
    if (ms > 0 && !out.includes(ms)) out.push(ms);
  }
  return out;
}
