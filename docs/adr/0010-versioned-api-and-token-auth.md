---
status: accepted
date: 2026-10-16
---

# A versioned `/api/v1/` surface with token authentication for native clients

The current API is unversioned and authenticates with `httpOnly` session
cookies (`server.js:1294-1311`). Both choices are reasonable for a web app where
we deploy client and server together. Neither survives an App Store release:
a published build stays in users' hands for months or years, so the server can
no longer assume the client was deployed with it, and native platforms handle
cookie persistence unreliably across app restarts.

Native clients therefore talk to **`/api/v1/`** using **short-lived access
tokens with rotating refresh tokens**. Tokens are held in secure device storage
(Keychain / Keystore), never in plain application storage, and are revocable
server-side so a lost device can be cut off.

The existing unversioned cookie endpoints **keep working untouched** for the web
app, which remains a live surface with real users (ADR 0005). This is additive:
no web behaviour changes, so the migration carries no risk to production.

A separate mobile backend was rejected — it would duplicate the business logic
that the shared-package decision (ADR 0003) exists to avoid duplicating.
Versioning by request header rather than URL path was rejected as less visible
and harder to reason about in logs.

## Requirements before the first release

- Compatibility rules written down: what a `v1` client may assume, and what the
  server may never change within `v1`.
- Those rules tested, with an old-client-against-new-server case in CI. An App
  Store client cannot be hot-fixed, so this must be proven rather than assumed.
- Session recovery defined: a refresh failure while offline must not destroy
  local data or lock a user out of reading their own Recipes (ADR 0006).
