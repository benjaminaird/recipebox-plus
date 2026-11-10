// The live timer store.
//
// Three things have to agree: what SQLite holds, what the OS has scheduled,
// and what is on screen. SQLite is the source of truth, because it is the only
// one that survives everything; the interval here exists purely to re-render a
// countdown, and deleting it would cost the animation and nothing else.
//
// That is why the tick never mutates a deadline. It advances `now` and the
// components recompute from stored absolute times, so a dropped tick, a
// backgrounded app or a four-hour sleep all produce the same correct answer.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { clearFinishedTimers, deleteTimer, listTimers, saveTimer } from "../data/db";
import {
  cancelTimerNotification, configureNotifications, ensureAndroidChannel,
  getPermission, requestPermission, scheduleTimerNotification,
  type PermissionState,
} from "../data/notifications";
import {
  adjustTimer, byUrgency, createTimer, formatRemaining, pauseTimer,
  remainingMs, restartTimer, resumeTimer, settle, type Timer,
} from "../domain/timer";

type StartInput = { label: string; durationMs: number; recipeId?: string; stepIndex?: number };

type TimerContextValue = {
  timers: Timer[];
  /** Advanced by the tick; components derive countdowns from it. */
  now: number;
  permission: PermissionState;
  ready: boolean;
  start: (input: StartInput) => Promise<void>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  restart: (id: string) => Promise<void>;
  adjust: (id: string, deltaMs: number) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  clearFinished: () => Promise<void>;
  askPermission: () => Promise<PermissionState>;
};

const TimerContext = createContext<TimerContextValue | null>(null);

/** One second while anything runs; the interval stops otherwise, so a screen
 *  with no timers does no work. */
const TICK_MS = 1000;

export function TimerProvider({ children }: { children: ReactNode }) {
  const [timers, setTimers] = useState<Timer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [permission, setPermission] = useState<PermissionState>("undetermined");
  const [ready, setReady] = useState(false);
  const timersRef = useRef<Timer[]>([]);
  timersRef.current = timers;

  const write = useCallback(async (next: Timer) => {
    setTimers((prev) => prev.map((t) => (t.id === next.id ? next : t)));
    await saveTimer(next).catch(() => {});
  }, []);

  // Load once, settling anything that finished while the app was closed.
  useEffect(() => {
    let live = true;
    configureNotifications();
    ensureAndroidChannel();
    (async () => {
      const [stored, perm] = await Promise.all([listTimers(), getPermission()]);
      if (!live) return;
      const t = Date.now();
      const settled = stored.map((timer) => settle(timer, t));
      setTimers(settled);
      setPermission(perm);
      setNow(t);
      setReady(true);
      for (const timer of settled) {
        const before = stored.find((s) => s.id === timer.id);
        if (before && before.status !== timer.status) await saveTimer(timer).catch(() => {});
      }
    })();
    return () => { live = false; };
  }, []);

  const anyRunning = timers.some((t) => t.status === "running");

  // The countdown. It only advances `now`.
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [anyRunning]);

  // Returning from the background: catch up at once rather than waiting a tick.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state !== "active") return;
      const t = Date.now();
      setNow(t);
      setTimers((prev) => {
        const next = prev.map((timer) => settle(timer, t));
        for (const timer of next) {
          const before = prev.find((p) => p.id === timer.id);
          if (before && before.status !== timer.status) saveTimer(timer).catch(() => {});
        }
        return next;
      });
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);

  // Settle on the tick, so a timer reaching zero with the app open flips to
  // finished without waiting for a background round trip.
  useEffect(() => {
    const stale = timersRef.current.filter(
      (t) => t.status === "running" && (t.endsAt ?? Infinity) <= now,
    );
    for (const timer of stale) write(settle(timer, now));
  }, [now, write]);

  const askPermission = useCallback(async () => {
    const next = await requestPermission();
    setPermission(next);
    return next;
  }, []);

  const reschedule = useCallback(async (timer: Timer) => {
    if (permission !== "granted" || !timer.endsAt) return;
    await scheduleTimerNotification({
      id: timer.id, title: timer.label, body: "Timer finished", endsAt: timer.endsAt,
    });
  }, [permission]);

  const start = useCallback(async (input: StartInput) => {
    const t = Date.now();
    const timer = createTimer({ ...input, now: t });
    setTimers((prev) => [...prev, timer]);
    await saveTimer(timer).catch(() => {});

    // Ask on first use, not at launch, when the question has no context.
    let perm = permission;
    if (perm === "undetermined") perm = await askPermission();
    if (perm === "granted" && timer.endsAt) {
      await scheduleTimerNotification({
        id: timer.id, title: timer.label, body: "Timer finished", endsAt: timer.endsAt,
      });
    }
  }, [permission, askPermission]);

  const pause = useCallback(async (id: string) => {
    const timer = timersRef.current.find((t) => t.id === id);
    if (!timer) return;
    await cancelTimerNotification(id);
    await write(pauseTimer(timer, Date.now()));
  }, [write]);

  const resume = useCallback(async (id: string) => {
    const timer = timersRef.current.find((t) => t.id === id);
    if (!timer) return;
    const next = resumeTimer(timer, Date.now());
    await write(next);
    await reschedule(next);
  }, [write, reschedule]);

  const restart = useCallback(async (id: string) => {
    const timer = timersRef.current.find((t) => t.id === id);
    if (!timer) return;
    const next = restartTimer(timer, Date.now());
    await write(next);
    await reschedule(next);
  }, [write, reschedule]);

  const adjust = useCallback(async (id: string, deltaMs: number) => {
    const timer = timersRef.current.find((t) => t.id === id);
    if (!timer) return;
    const next = adjustTimer(timer, deltaMs, Date.now());
    await write(next);
    await reschedule(next);
  }, [write, reschedule]);

  const dismiss = useCallback(async (id: string) => {
    await cancelTimerNotification(id);
    setTimers((prev) => prev.filter((t) => t.id !== id));
    await deleteTimer(id).catch(() => {});
  }, []);

  const clearFinished = useCallback(async () => {
    setTimers((prev) => prev.filter((t) => t.status !== "done"));
    await clearFinishedTimers().catch(() => {});
  }, []);

  const value = useMemo<TimerContextValue>(() => ({
    timers: [...timers].sort(byUrgency(now)),
    now, permission, ready,
    start, pause, resume, restart, adjust, dismiss, clearFinished, askPermission,
  }), [timers, now, permission, ready, start, pause, resume, restart, adjust, dismiss, clearFinished, askPermission]);

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimers(): TimerContextValue {
  const v = useContext(TimerContext);
  if (!v) throw new Error("useTimers must be used inside <TimerProvider>");
  return v;
}

/** A countdown string for a timer, against the shared tick. */
export function useRemainingLabel() {
  const { now } = useTimers();
  return useCallback((t: Timer) => formatRemaining(remainingMs(t, now)), [now]);
}
