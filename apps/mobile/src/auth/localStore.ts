// Which local database a signed-in account may open.
//
// The requirement is that one person's recipes are not visible to the next
// person who signs in on the same phone. The tempting implementation — clear
// the database when the account changes — is the one thing ADR 0006 forbids,
// because the first account's recipes may be the only copy. So accounts are
// separated rather than erased: a second account gets its own store, and the
// first one's is still there if they sign back in.
//
// The device's existing local library belongs to whoever signs in first. It
// was theirs before they had an account (the app is local-first and works
// signed out), so signing in claims it rather than abandoning it.

export const BASE_LOCAL_STORE = "recipebox.db";

export type LocalStoreResolution = {
  /** The SQLite file to open. */
  name: string;
  /** Who the base store belongs to after this resolution, to be persisted. */
  claimedBy: string | null;
  /** True when this account is reading a store of its own, apart from the base one. */
  isolated: boolean;
};

/**
 * Deterministic, short, and not reversible into an email address: the file
 * name sits on disk and in backups, where an account identifier is nobody's
 * business but the owner's.
 */
function storeSuffix(userId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function resolveLocalStore(input: {
  claimedBy: string | null;
  signedInUserId: string | null;
  /**
   * Who was signed in last, if nobody is now. Signing out must not hand the
   * device back to the account that owns the base store: a guest who signs out
   * on a borrowed phone would otherwise be looking at the owner's recipes.
   */
  lastUserId?: string | null;
}): LocalStoreResolution {
  const { claimedBy, signedInUserId } = input;
  const effective = signedInUserId ?? input.lastUserId ?? null;

  // Nobody has ever signed in here: the local-first library, exactly as the
  // app has always opened it.
  if (!effective) return { name: BASE_LOCAL_STORE, claimedBy, isolated: false };

  // First account to sign in on this device adopts what is already here — it
  // was theirs before they had an account. Only an actual sign-in claims it.
  if (!claimedBy) return { name: BASE_LOCAL_STORE, claimedBy: signedInUserId ?? null, isolated: false };

  if (claimedBy === effective) return { name: BASE_LOCAL_STORE, claimedBy, isolated: false };

  // Somebody else, signed in or just signed out. Their own store, and the
  // owner's is left exactly where it was.
  return { name: "recipebox-" + storeSuffix(effective) + ".db", claimedBy, isolated: true };
}

/**
 * Act on a resolution: open the library it names, then hand it back.
 *
 * This exists so that deciding which store an account may open and actually
 * opening it cannot drift apart again. They did: the resolver was complete and
 * tested, the Account screen already told the cook when their library was a
 * separate one, and nothing ever opened the file — so a second account on a
 * shared phone read the first account's recipes under a notice saying it
 * could not. Every path that produces a resolution goes through here, and the
 * opener is a parameter so the wiring itself is what the tests check.
 */
export async function applyLocalStore(
  resolution: LocalStoreResolution,
  open: (name: string) => Promise<void>,
): Promise<LocalStoreResolution> {
  await open(resolution.name);
  return resolution;
}

/**
 * What a sign-out does to local data. It is a function returning a constant on
 * purpose: the answer is "nothing", and a named, tested answer is harder to
 * change by accident than an absence of code.
 */
export function localDataOnSignOut(): "keep" {
  return "keep";
}
