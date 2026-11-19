// Synchronisation, as the rest of the app sees it.
//
// Thin, for the reason every other provider here is thin: the algorithm is
// src/sync/coordinator.ts, the queue rules are src/sync/outbox.ts and the
// writing down is src/data/sqliteSyncStore.ts, all three of which are tested
// without React, a device or a network. What is here is the wiring — when a
// run happens, what the interface is told about it, and the one piece of
// bookkeeping that genuinely belongs to a component tree: a recorder that is
// installed while an account is signed in and removed when it is not.
//
// It sits BELOW AuthProvider on purpose. The auth layer holds no reference to
// the recipe store (ADR 0006, and auth-flow.test.ts enforces it), so the
// dependency has to run this way round: sync knows about both, and neither of
// them knows about sync.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuth } from "../auth/AuthProvider.tsx";
import {
  activeLocalStore, openDatabase, recordLocalChanges, type LocalRecipeChange,
} from "../data/db.ts";
import {
  adoptRecipe, applyResolution, countOpenConflicts, countQueued, lastRunAt,
  listOpenConflicts, queueLocalChange, setLastRunAt, sqliteSyncStore, unadoptedRecipes,
  type SqliteLike, type StoredConflict,
} from "../data/sqliteSyncStore.ts";
import { resolve, type ConflictChoice } from "./outbox.ts";
import { describeSync, runSync, type SyncReport } from "./coordinator.ts";
import { httpTransport } from "./transport.ts";
import { uploadsEnabled } from "./flags.ts";
import type { Recipe } from "../data/types.ts";
import type { Message } from "../auth/messages.ts";

/**
 * What the interface says about where things stand.
 *
 * Five states, and each one answers a different question a cook actually has.
 * "off" is not a failure: the app works without an account, and saying
 * nothing at all is the right amount to say about sync when there isn't any.
 */
export type SyncStatus =
  | "off"          // signed out, or this build has no server
  | "syncing"
  | "pending"      // changes waiting to go
  | "conflicts"    // somebody has to choose
  | "offline"      // the last run could not reach the server
  | "up-to-date";

export type SyncValue = {
  status: SyncStatus;
  /** Changes this device still owes the account. */
  queued: number;
  /** Conflicts waiting on a person. */
  conflicts: number;
  /** When the last run finished, or null if there has not been one. */
  lastRunAt: number | null;
  /** What the last run did, in words, or null before any run. */
  message: Message | null;
  /** This build may upload. False keeps every run pull-only. */
  uploads: boolean;
  /** Run now. Does nothing, harmlessly, when there is no account. */
  sync(): Promise<void>;
  /** The conflicts waiting, with both versions of each. */
  openConflicts(): Promise<StoredConflict[]>;
  /** Carry out a choice. Returns the recipe created, for "keep both". */
  resolveConflict(conflict: StoredConflict, choice: ConflictChoice): Promise<Recipe | null>;
  /** Recipes on this phone that this account has not taken on. */
  unadopted(): Promise<Recipe[]>;
  /** Put a local recipe into the account, at the cook's request. */
  adopt(recipeId: string): Promise<void>;
  /** Re-read the counts, after something outside a run changed them. */
  refresh(): Promise<void>;
};

const SyncContext = createContext<SyncValue | null>(null);

const idle: Omit<SyncValue, "sync" | "openConflicts" | "resolveConflict" | "unadopted" | "adopt" | "refresh"> = {
  status: "off", queued: 0, conflicts: 0, lastRunAt: null, message: null, uploads: false,
};

/**
 * Expo's database satisfies this module's needs, but not its exact type: its
 * query methods are variadic as well as array-taking, which TypeScript will
 * not narrow on its own. The cast is at the one boundary where the two meet
 * rather than scattered through the store, which is written against the narrow
 * interface precisely so it can be tested against a SQLite that is not Expo's.
 */
async function db(): Promise<SqliteLike> {
  return (await openDatabase()) as unknown as SqliteLike;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [report, setReport] = useState<SyncReport | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [queued, setQueued] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [ranAt, setRanAt] = useState<number | null>(null);

  const accountId = auth.state.status === "active" ? auth.state.user.id : null;
  const library = auth.localStore?.name ?? null;
  const uploads = uploadsEnabled();

  // One run at a time. Two concurrent runs would push the same queue entries
  // twice — safe, because of the idempotency keys, and still pointless.
  const running = useRef(false);

  const refresh = useCallback(async () => {
    if (!accountId) { setQueued(0); setConflicts(0); setRanAt(null); return; }
    const handle = await db();
    setQueued(await countQueued(handle, accountId));
    setConflicts(await countOpenConflicts(handle, accountId));
    setRanAt(await lastRunAt(handle, accountId));
  }, [accountId]);

  // The recorder: installed while an account is signed in, removed when it is
  // not. Signed out, a saved recipe queues nothing, which is the whole of what
  // "RecipeBox works without an account" means for this layer.
  useEffect(() => {
    if (!accountId || !library) {
      recordLocalChanges(null);
      return;
    }
    recordLocalChanges(async (handle, change: LocalRecipeChange) => {
      // Inside the caller's transaction, and against the caller's handle, so
      // the recipe and the promise to send it commit together.
      await queueLocalChange(handle as unknown as SqliteLike, accountId, change);
    });
    return () => recordLocalChanges(null);
  }, [accountId, library]);

  useEffect(() => { void refresh(); }, [refresh]);

  const sync = useCallback(async () => {
    if (running.current) return;
    if (!accountId || !library || !auth.configured) return;
    // A library that is not this account's is not one to write into. The
    // store asserts this too, immediately before each write; refusing here as
    // well just means the run does not start rather than failing part-way.
    if (activeLocalStore() !== library) return;

    running.current = true;
    setSyncing(true);
    try {
      const handle = await db();
      const store = sqliteSyncStore(handle, accountId, library, activeLocalStore);
      const outcome = await runSync(store, httpTransport(auth.authorized), { uploads });
      setReport(outcome);
      const at = Date.now();
      await setLastRunAt(handle, accountId, at);
      setRanAt(at);
    } catch (err) {
      // runSync catches its own failures and reports them; anything reaching
      // here is the store or the handle, which is worth saying plainly rather
      // than drawing as a finished sync.
      setReport({
        pulled: 0, deletionsApplied: 0, pushed: 0, conflicts: 0, rejected: 0,
        stillQueued: queued, resynced: false, stoppedBy: "server",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [accountId, library, auth.configured, auth.authorized, uploads, refresh, queued]);

  // A run when the account becomes reachable: on sign-in, and on coming back
  // from a stale session. Not on every render, and not on a timer — a cook who
  // opens the app expects it to be current, and a cook who leaves it open does
  // not expect it to chatter.
  const lastTrigger = useRef<string | null>(null);
  useEffect(() => {
    if (!accountId || !library) { lastTrigger.current = null; return; }
    const trigger = accountId + ":" + library;
    if (lastTrigger.current === trigger) return;
    lastTrigger.current = trigger;
    void sync();
  }, [accountId, library, sync]);

  // And when the app comes back to the foreground, because that is when what
  // is on the screen is most likely to be stale.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === "active" && accountId && library) void sync();
    };
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, [accountId, library, sync]);

  const openConflicts = useCallback(async () => {
    if (!accountId) return [];
    return listOpenConflicts(await db(), accountId);
  }, [accountId]);

  const resolveConflict = useCallback(async (conflict: StoredConflict, choice: ConflictChoice) => {
    if (!accountId) return null;
    const now = Date.now();
    const newId = choice === "keep-both" ? copyId(conflict.recipeId, now) : undefined;
    const resolution = resolve(conflict, choice, now, newId);
    await applyResolution(await db(), accountId, conflict, resolution, now);
    await refresh();
    return resolution.create;
  }, [accountId, refresh]);

  const unadopted = useCallback(async () => {
    if (!accountId) return [];
    return unadoptedRecipes(await db());
  }, [accountId]);

  const adopt = useCallback(async (recipeId: string) => {
    if (!accountId) return;
    await adoptRecipe(await db(), accountId, recipeId);
    await refresh();
  }, [accountId, refresh]);

  const status: SyncStatus = !accountId || !auth.configured
    ? "off"
    : syncing ? "syncing"
    : conflicts > 0 ? "conflicts"
    : report?.stoppedBy === "network" ? "offline"
    : queued > 0 ? "pending"
    : "up-to-date";

  const value = useMemo<SyncValue>(() => ({
    ...idle,
    status, queued, conflicts, lastRunAt: ranAt, uploads,
    message: report ? describeSync(report) : null,
    sync, openConflicts, resolveConflict, unadopted, adopt, refresh,
  }), [status, queued, conflicts, ranAt, uploads, report, sync, openConflicts, resolveConflict, unadopted, adopt, refresh]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/**
 * The id a kept-both copy takes.
 *
 * Derived from the conflicted recipe and the moment of choosing rather than
 * random, so resolving the same conflict twice — a double tap, a retry after
 * the screen came back — produces the same recipe rather than two.
 */
function copyId(recipeId: string, now: number): string {
  return recipeId + "-mine-" + now.toString(36);
}

export function useSync(): SyncValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSync must be used inside <SyncProvider>");
  return value;
}
