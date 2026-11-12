---
status: proposed — design only, no code written
date: 2026-11-12
---

# Native authentication for `/api/v1`: design proposal

Implements [ADR 0010](./adr/0010-versioned-api-and-token-auth.md). Nothing here
is built; `server.js` is unchanged by this document. It ends with the decisions
that are not mine to make.

## What already exists, and why that settles most of this

The web app's authentication is in better shape for this than it might have
been, and the design is mostly a matter of not spoiling it.

| Thing | Where | Shape |
| --- | --- | --- |
| Identity | `profiles` | `user_id text` primary key, `email`, `display_name`, `role`, `email_verified`, `password_hash` |
| Web sessions | `account_sessions` | `token_hash` PK, `user_id`, `expires_at`, `created_at`, `last_seen_at` |
| Token minting | `createSession()` | 32 random bytes, base64url, **stored only as a SHA-256 hash** |
| Token delivery | `rb_session` cookie | `httpOnly`, `sameSite` lax (none cross-origin), `secure` on Vercel |
| Token check | `currentUser()` | hash lookup + `expires_at > now()`, then slides the expiry forward |
| Gate | `requireAuth` | 401 `sign in required`, sets `req.user` |
| Households | `households`, `household_members` | one household per user, enforced by a unique index on `household_members.user_id` |
| Rate limiting | `checkRateLimit()`, `checkAuthLimit()` | DB-backed in `rate_limit_counters`; per-IP, per-user and burst buckets |

**The important consequence:** a device token is the same primitive as a web
session — an opaque random secret, stored hashed, looked up per request. The
native client needs a different *delivery* (an `Authorization` header rather
than a cookie), a different *lifetime*, and device-level revocation. It does
not need a different identity system, and ADR 0010's instruction not to build
one is therefore cheap to honour: `profiles` stays the only account table.

### Two things found while reading, which the design has to take a view on

1. **`SESSION_DAYS = 3650`.** Web sessions last ten years and `currentUser()`
   slides the expiry forward on every request, so in practice a web session
   never ends. That is a product choice for a cookie on someone's own laptop.
   It must **not** be copied to a device token, and ADR 0010 already says so
   ("short-lived access tokens"). Flagged rather than changed: altering web
   session lifetime is a live-behaviour change and not part of this work.
2. **`/api/auth/signin` does not check `email_verified`.** An unverified
   account can sign in and use the web app today. Whether the native client
   should match that or require verification is an open decision below — the
   wrong move is to diverge silently, so that is not proposed here.

## The shape: opaque access + rotating refresh

ADR 0010 fixes the model (short-lived access tokens, rotating refresh tokens,
Keychain/Keystore, server-side revocation). What it leaves open is the token
*format*, and this proposes **opaque random tokens, hashed in the database**
for both, rather than JWTs.

**Why not JWTs.** The attraction of a JWT is skipping a database read. That
benefit is worth little here and the costs are real:

- **Revocation is a stated requirement.** A JWT is valid until it expires
  unless you keep a server-side blocklist — which is the database read the JWT
  was supposed to avoid, plus a second mechanism to get wrong.
- **The existing code already reads the database on every authenticated
  request.** Opaque tokens add no new cost pattern, and `requireAuth` and
  `requireDeviceAuth` end up structurally identical.
- **No key management.** No signing key to provision, rotate, or leak, no JWKS
  endpoint, no algorithm-confusion class of bug, no new dependency in a project
  with four production dependencies.

The cost of the opaque choice is one indexed primary-key lookup per request.
That is the right trade for this product, and it is reversible later per
`/api/v1` compatibility rules, because the token is opaque to the client by
construction — clients may never parse it.

### Why a second table rather than reusing `account_sessions`

A separate `device_sessions` table, because a cookie token and a bearer token
should not be interchangeable. If both lived in one table, a stolen
`rb_session` cookie value could be replayed as a `Bearer` token against
`/api/v1`, and a device token could be set as a cookie against the legacy
routes — turning two credentials with different exposure and different
lifetimes into one. Separate tables make that a schema impossibility rather
than a code-review question.

## API contract

All under `/api/v1`, mounted as its own Express router. Every response is JSON.
Errors carry a stable machine-readable `code`; clients switch on `code`, never
on `message`, which may be reworded.

### `POST /api/v1/auth/signin`

```
{ "email": "…", "password": "…", "device": { "name": "Ben's iPhone", "platform": "ios", "installId": "<uuid>" } }

200 {
  "accessToken":  "<opaque>",
  "expiresIn":    900,                  // seconds
  "refreshToken": "<opaque>",
  "refreshExpiresIn": 2592000,
  "user": { "id": "…", "email": "…", "displayName": "…", "emailVerified": true }
}
401 { "code": "invalid_credentials", "message": "Email or password did not match." }
429 { "code": "rate_limited", "retryAfter": 900 }
```

Credentials are checked by the **same** `verifyPassword` against the **same**
`profiles` row the web app uses. No new account, no second password store.

### `POST /api/v1/auth/refresh`

```
{ "refreshToken": "<opaque>" }

200 { "accessToken": "…", "expiresIn": 900, "refreshToken": "<new>", "refreshExpiresIn": 2592000 }
401 { "code": "refresh_invalid" }     // unknown, expired, or already used
```

**Rotation with reuse detection.** Every refresh issues a new refresh token and
marks the presented one used. Presenting an already-used token means the token
was captured and replayed, so the whole device chain is revoked and the user
signs in again. This is the one place the design is deliberately harsh: a
false positive costs a sign-in, a false negative costs an account.

### `POST /api/v1/auth/signout`

Revokes the presented device's chain. Idempotent; always `200`.

### `GET /api/v1/auth/devices` and `DELETE /api/v1/auth/devices/:id`

Lists this account's devices (name, platform, created, last seen) and revokes
one — "sign out my lost phone", which is the point of device-level revocation.
A device may always revoke itself; revoking another device requires a
non-expired access token on the current one.

### `GET /api/v1/me`

The current user, for checking a token is still good without a side effect.

### Everything else

`/api/v1/import/fetch` per [native-import-contract.md](./native-import-contract.md),
and the sync surface from ADR 0006 when it is built. Both sit behind
`requireDeviceAuth` and reuse the existing household and recipe authorization
helpers unchanged.

## Migrations

Additive only. New tables and indexes, created by the existing
`CREATE TABLE IF NOT EXISTS` bootstrap. **No existing table is altered and no
column is dropped** — `CLAUDE.md` makes the Neon schema load-bearing for real
users, and nothing here needs to touch it.

```sql
CREATE TABLE IF NOT EXISTS device_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  device_name   text NOT NULL DEFAULT 'Unknown device',
  platform      text NOT NULL DEFAULT 'unknown',   -- 'ios' | 'android'
  install_id    text,                              -- client-generated, for de-duplication
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

-- Access and refresh tokens, hashed. One row per live token; a rotation
-- inserts a new row and stamps the old one used.
CREATE TABLE IF NOT EXISTS device_tokens (
  token_hash  text PRIMARY KEY,
  device_id   uuid NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
  kind        text NOT NULL,                       -- 'access' | 'refresh'
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,                         -- refresh only: set on rotation
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_sessions_user_idx ON device_sessions (user_id);
CREATE INDEX IF NOT EXISTS device_tokens_device_idx ON device_tokens (device_id);
CREATE INDEX IF NOT EXISTS device_tokens_expiry_idx ON device_tokens (expires_at);
```

Tokens are the same 32-random-byte base64url value the web app mints, stored as
a SHA-256 hash. A bare SHA-256 is correct here and a slow KDF would be
pointless: the input is 256 bits of entropy, not a human-chosen password, so
there is nothing to brute-force.

Expired rows are deleted opportunistically on refresh and sign-in, the way
`rate_limit_counters` is already handled, so no scheduled job is introduced.

## Credential storage on the device

- **Refresh token → `expo-secure-store`**, which is iOS Keychain and Android
  EncryptedSharedPreferences backed by Keystore. iOS accessibility
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`: available to background sync after a
  reboot-and-unlock, never synced to iCloud, never restored onto a different
  device.
- **Access token → memory only.** It lives 15 minutes; writing it to disk adds
  exposure and buys nothing.
- **Nothing long-lived in the bundle.** Required by the brief and free here,
  because the client ships with no secret at all: it has credentials only after
  someone signs in. There is no app-level API key to leak, which also means no
  key rotation story is needed.
- **Account switching isolates the local database** (ADR 0006). Sign-out
  discards tokens and detaches the local store; it must not delete it, because
  a sign-out is not a request to destroy someone's recipes.

## Authorization is independent of how you authenticated

The rule that keeps this from becoming two security models: `requireDeviceAuth`
populates `req.user` with **the same shape** `requireAuth` does, and every
authorization decision downstream is unchanged. Household membership and role
come from `household_members` through the existing
`isHouseholdOwner` / `canInviteToHousehold` / `canAddHouseholdMember` helpers;
recipe ownership keeps going through `upsertUserRecipe` and
`readVisibleRecipesPage`.

So a native client can do exactly what the same person can do on the web, and
nothing more, because the same functions decide. No route learns which
transport it was reached by.

**Deliberately not symmetric:** a device token is accepted **only** under
`/api/v1`, and a session cookie is accepted **only** on the legacy routes.
Neither honours the other. That costs nothing — the native client has no reason
to call the legacy routes — and it keeps a stolen credential confined to the
surface it came from. It also means `/api/v1` needs no CSRF defence, because
nothing is sent automatically by a browser.

## Threat model

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Refresh token stolen off a device | Keychain/Keystore, device-only, not backed up; rotation means a captured token is single-use | A jailbroken or rooted device with the user unlocked can still read it. Accepted; detection is out of scope |
| Refresh token captured in transit and replayed | Rotation with reuse detection revokes the whole chain | A race in which the attacker refreshes first leaves the legitimate device locked out — which is the correct failure, and it is visible to the user |
| Access token leaked (logs, crash report) | 15-minute lifetime, never written to disk | A 15-minute window. Do not log `Authorization` headers; worth a lint rule |
| Lost or stolen device | `DELETE /api/v1/auth/devices/:id` revokes server-side immediately, since tokens are checked against the database every request | Already-downloaded recipes stay readable on that device (ADR 0006 requires it) |
| Credential stuffing against native sign-in | Reuse `checkAuthLimit` — DB-backed, per-IP, same limits as the web | `checkRateLimit` **fails open with no database**; see the open decisions |
| Bearer token replayed as a web cookie, or vice versa | Separate tables; neither surface honours the other's credential | — |
| CSRF against `/api/v1` | Bearer tokens are not sent automatically by any browser | — |
| Account enumeration | Sign-in returns one message for unknown email and wrong password, as the web does | Timing differences remain, as they do on the web |
| Privilege escalation into another household | No new authorization path; the existing helpers and the one-household-per-user unique index decide | — |
| Device list leaking another account's devices | Scoped to `req.user.user_id` | — |
| Token-hash database leak | Only hashes are stored; a hash is not usable as a credential | An attacker with the database has the data anyway |

## Testing strategy

Offline, no database, no network — the house style in `scripts/`, and the
reason the existing suites can run in CI with nothing installed.

1. **Unit, pure:** token minting is 256 bits of entropy and base64url; hashing
   matches `hashToken`; expiry arithmetic; rotation marks the old token used.
2. **Rotation and reuse detection:** a refresh succeeds once; the same token a
   second time fails **and** revokes the chain; a token from a revoked device
   fails. This is the test that would catch a silent downgrade to
   non-rotating refresh.
3. **Revocation:** revoking a device invalidates its access token on the very
   next request, proving the credential is checked per request rather than
   trusted until expiry.
4. **Isolation, both ways:** a device token presented as a cookie to a legacy
   route is rejected; a session cookie presented as a bearer token to
   `/api/v1` is rejected.
5. **Authorization parity:** the same account reaches the same households and
   recipes through both transports, and a second account reaches neither. The
   assertion is equality between transports, so a divergence fails rather than
   being noticed later.
6. **Web regression:** every existing suite, plus `web-preview-check`, plus a
   byte-comparison of the auth routes' behaviour against `main` — the method
   already used to prove the `recipe-core` extraction and the fetch hardening
   changed nothing.
7. **Rate limiting:** native sign-in shares the web's buckets, and exhausting
   one returns a structured `429`.
8. **ADR 0010's old-client-against-new-server case**, below.

### The compatibility case ADR 0010 requires

ADR 0010 requires this to be *proven*, not assumed, because an App Store build
cannot be hot-fixed. The proposal: a frozen fixture describing what a `v1`
client sends and expects — request shapes, response fields it reads, error
codes it switches on — committed as data and replayed in CI against the live
router. Adding a field passes; removing or renaming one fails.

Written down as the `v1` contract, and what the server may never change within
`v1`:

- No field is removed or renamed, and no field's type changes.
- No error `code` is removed or repurposed. New codes may be added, and
  clients must treat an unknown `code` as a generic failure.
- No endpoint requires a request field it did not previously require.
- Token formats stay opaque. A client that parses one is out of contract, which
  is what keeps the JWT decision reversible.
- `expiresIn` may shrink. A client must handle a 401 on any call by refreshing
  once and retrying, rather than trusting the clock.

### Session recovery, which ADR 0010 also requires

A refresh failure while offline must not destroy local data or lock a user out
of reading their own recipes (ADR 0006). So:

- Failing to refresh **never** clears the local database and never signs the
  user out. It marks the session stale.
- A stale session keeps every local read working — recipes, Cook Mode, lists.
  Only sync and Connected Imports are withheld, and they say why.
- Refresh is retried with backoff when connectivity returns. Only an explicit
  `refresh_invalid` from the **server** (as opposed to a network failure) asks
  the user to sign in again, and even then the local store is retained until
  they sign in as someone else.

That distinction — network failure versus server rejection — is the whole of
the requirement, and it is the thing to test with the network off rather than
reason about.

## Deployment implications

- **Additive.** New routes under a new prefix, two new tables, no change to any
  existing route, table, or column. The web app is untouched, which is what
  ADR 0010 is for.
- **No new environment variables required.** Token lifetimes should be
  constants in code, not configuration, so they are reviewable in the diff and
  identical in every environment.
- **No new dependency.** `crypto` mints and hashes; `pg` stores.
- **Vercel.** `/api/v1/*` is served by the same function as `/api/*` via the
  existing `api/index.js` rewrite; no `vercel.json` change.
- **Order of release.** This ships and is exercised by a TestFlight/internal
  build before any App Store release, because the compatibility rules above
  only start binding once a build is in users' hands.
- **No production data migration.** The tables start empty; nothing backfills.

## Decisions I am not making unilaterally

These change the product's security posture or its behaviour for real users,
and the design is deliberately parked here rather than guessing:

1. **Token lifetimes.** Proposed: access 15 minutes, refresh 30 days with
   rotation. The web's `SESSION_DAYS = 3650` is not a precedent worth
   following, but 30 days is a product decision about how often a cook has to
   re-type a password.
2. **Does native sign-in require a verified email?** The web does not check
   `email_verified`. Matching it is consistent; requiring verification is
   safer. Diverging silently is the only wrong answer.
3. **What `checkRateLimit` failing open should mean here.** With no database it
   currently allows the request. That is defensible for a sign-in form and
   questionable for token issuance.
4. **Whether the web should also get device management.** The tables support
   it, and "sign out all devices" is more useful than it is expensive — but it
   is web UI work, which is out of scope by `CLAUDE.md` until approved.
5. **Whether to implement now or after review.** The recommendation is after:
   every decision above lands in the schema or the token lifecycle, and
   changing them later means a migration against rows that real devices are
   holding tokens for.
