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
  fullResync, heldRecipes, listOpenConflicts, putSharedRecipe, queueLocalChange,
  revokeSharedRecipes, saveMyOwnCopy, setLastRunAt, sharedBy, sqliteSyncStore,
  unadoptedRecipes, type ResyncOutcome, type SqliteLike, type StoredConflict,
} from "../data/sqliteSyncStore.ts";
import { planHouseholdRead } from "./household.ts";
import { resolve, type ConflictChoice } from "./outbox.ts";
import { describeSync, runSync, type SyncReport } from "./coordinator.ts";
import { httpTransport, readLibrary } from "./transport.ts";
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
  /** Whether a recipe is somebody else's, and whose. */
  provenance(recipeId: string): Promise<{ shared: boolean; ownerId: string | null }>;
  /** Save a household recipe as this account's own. Returns the copy. */
  saveMyCopy(original: Recipe, ownerName: string | null): Promise<Recipe | null>;
  /** Forget everything from the account and fetch it again. */
  resync(): Promise<ResyncOutcome | null>;
  /** Shared recipes dropped by the last run, because access went. */
  revoked: number;
};

const SyncContext = createContext<SyncValue | null>(null);

const idle = {
  status: "off" as SyncStatus, queued: 0, conflicts: 0, lastRunAt: null as number | null,
  message: null as Message | null, uploads: false, revoked: 0,
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
  const [revoked, setRevoked] = useState(0);

  /**
   * The account and the library it may use, taken together or not at all.
   *
   * These are two pieces of state in AuthProvider, set one after the other,
   * and comparing file names does not notice when a render falls between
   * them: a new account beside the previous account's library has two
   * different names, both perfectly valid, and the mismatch is invisible.
   * That is how one person's recipes reached another person's screen the
   * first time. So the resolution says who it was resolved FOR, and nothing
   * here runs unless that is this account.
   */
  const active = auth.state.status === "active" ? auth.state.user : null;
  const resolution = auth.localStore;
  const settled = active && resolution && resolution.forUserId === active.id;
  const accountId = settled ? active.id : null;
  const library = settled ? resolution.name : null;
  const uploads = uploadsEnabled();

  /** The guard every write carries: this account's library, checked as it writes. */
  const guard = useMemo(
    () => (library ? { expected: library, active: activeLocalStore } : null),
    [library],
  );

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
    if (!accountId || !guard) {
      recordLocalChanges(null);
      return;
    }
    recordLocalChanges(async (handle, change: LocalRecipeChange) => {
      // Inside the caller's transaction, and against the caller's handle, so
      // the recipe and the promise to send it commit together. The guard is
      // checked there, not here: this is the busiest write path in the app,
      // and a sign-in can land between the save starting and the row being
      // written.
      await queueLocalChange(handle as unknown as SqliteLike, accountId, change, Date.now(), guard);
    });
    return () => recordLocalChanges(null);
  }, [accountId, guard]);

  useEffect(() => { void refresh(); }, [refresh]);

  const sync = useCallback(async () => {
    if (running.current) return;
    if (!accountId || !library || !auth.configured) return;
    // The library open is not this account's: the run does not start, rather
    // than failing part-way. The store asserts the same thing immediately
    // before each write, because opening is asynchronous and this answer can
    // stop being true between here and there.
    if (activeLocalStore() !== library) return;

    running.current = true;
    setSyncing(true);
    try {
      const handle = await db();
      const store = sqliteSyncStore(handle, accountId, library, activeLocalStore);
      const outcome = await runSync(store, httpTransport(auth.authorized), { uploads });
      setReport(outcome);

      // The household half, after the account's own.
      //
      // These do not come down the delta feed and never will: that feed is a
      // replica of this account's recipes, and a replica of somebody else's is
      // a copy this account could be asked to write back. They come from the
      // library view, which answers the same question the browser asks and
      // checks household membership in the query itself.
      //
      // Only when the delta half actually finished. A failed run tells us
      // nothing about who may see what, and treating silence as "access was
      // withdrawn" would delete a cook's shared recipes every time their train
      // went into a tunnel.
      if (outcome.stoppedBy === "done") {
        try {
          const visible = await readLibrary(auth.authorized);
          const plan = planHouseholdRead(visible, await heldRecipes(handle, accountId));
          for (const envelope of plan.store) await putSharedRecipe(handle, accountId, envelope);
          setRevoked(await revokeSharedRecipes(handle, accountId, plan.revoke));
        } catch {
          // The account's own recipes are already synced and safe. A household
          // read that failed is worth nothing and costs nothing: next run.
          setRevoked(0);
        }
      }

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
    const chosen = resolve(conflict, choice, now, newId);
    // Everything the choice implies — the record, the copy, the queued change
    // and putting a deleted recipe back — happens in one transaction inside
    // applyResolution. Doing any of it out here was a write with none of the
    // gates its siblings have, and it put back the wrong version besides.
    await applyResolution(await db(), accountId, conflict, chosen, now, guard ?? undefined);
    await refresh();
    return chosen.create;
  }, [accountId, guard, refresh]);

  const provenance = useCallback(async (recipeId: string) => {
    if (!accountId) return { shared: false, ownerId: null };
    return sharedBy(await db(), recipeId);
  }, [accountId]);

  const saveMyCopy = useCallback(async (original: Recipe, ownerName: string | null) => {
    if (!accountId) return null;
    const now = Date.now();
    // Derived from the original and the moment, so a double tap makes one
    // recipe rather than two.
    const newId = original.id + "-copy-" + now.toString(36);
    const copy = await saveMyOwnCopy(
      await db(), accountId, original, ownerName, newId, now, guard ?? undefined,
    );
    await refresh();
    return copy;
  }, [accountId, guard, refresh]);

  const resync = useCallback(async () => {
    if (!accountId || running.current) return null;
    running.current = true;
    setSyncing(true);
    try {
      const outcome = await fullResync(await db(), accountId, guard ?? undefined);
      await refresh();
      return outcome;
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [accountId, guard, refresh]);

  const unadopted = useCallback(async () => {
    if (!accountId) return [];
    return unadoptedRecipes(await db(), accountId);
  }, [accountId]);

  const adopt = useCallback(async (recipeId: string) => {
    if (!accountId) return;
    await adoptRecipe(await db(), accountId, recipeId, Date.now(), guard ?? undefined);
    await refresh();
  }, [accountId, guard, refresh]);

  const status: SyncStatus = !accountId || !auth.configured
    ? "off"
    : syncing ? "syncing"
    : conflicts > 0 ? "conflicts"
    : report?.stoppedBy === "network" ? "offline"
    : queued > 0 ? "pending"
    : "up-to-date";

  /**
   * A finished run describes what it did. It stops describing where things
   * stand the moment anything changes after it — and "Up to date, nothing
   * new" in calm green, beside a row saying a change is waiting to go up, is
   * worse than saying nothing: it is the same wrong reassurance that an
   * earlier version of this screen gave for a download that had failed.
   */
  const stale = report !== null && (
    // It reported conflicts, and they have since been settled.
    (report.conflicts > 0 && conflicts === 0)
    // Or it reported everything done, and something has happened since.
    || (report.conflicts === 0 && report.stoppedBy === "done" && (queued > 0 || conflicts > 0))
  );

  const value = useMemo<SyncValue>(() => ({
    ...idle,
    status, queued, conflicts, lastRunAt: ranAt, uploads, revoked,
    message: report && !stale ? describeSync(report) : null,
    sync, openConflicts, resolveConflict, unadopted, adopt, refresh,
    provenance, saveMyCopy, resync,
  }), [status, queued, conflicts, ranAt, uploads, revoked, report, stale, sync, openConflicts,
       resolveConflict, unadopted, adopt, refresh, provenance, saveMyCopy, resync]);

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
