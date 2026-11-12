---
status: accepted
date: 2026-11-12
---

# How long a device stays signed in, and who may sign in at all

[ADR 0010](./0010-versioned-api-and-token-auth.md) settled that native clients
use short-lived access tokens with rotating refresh tokens. It did not say how
short, how long, or whether an account whose email was never confirmed may have
one. Those are product decisions with security consequences, and they are
recorded here because every one of them lands in the schema or the token
lifecycle, where changing them later means a migration against rows that real
devices hold tokens for.

The design they implement is [docs/native-auth-design.md](../native-auth-design.md).

## Lifetimes

| | Value | Rolling? |
| --- | --- | --- |
| Access token | 15 minutes | no |
| Refresh token | 30 days | yes — every use starts a new 30 days |
| Device session | 180 days | **no** |

The third row is the one that needed deciding. A rolling refresh window with no
ceiling makes a session permanent for anyone who opens the app once a month,
which is most cooks. The web app already works that way — `SESSION_DAYS = 3650`,
slid forward on every request — and that is defensible for a cookie on
someone's own laptop and indefensible for a credential in a pocket that can be
lost, sold or handed to a repair shop.

Six months is chosen so that the ceiling is felt roughly twice a year, at a
moment when the person is already holding the phone, and so that a device that
has quietly dropped off the account's radar cannot sit there indefinitely. The
refresh window is truncated as the ceiling approaches rather than promising a
month the session will not get, so the client is never surprised.

Rotation is unconditional: every successful refresh issues a new refresh token
and spends the presented one. Presenting a spent token revokes the whole device
chain — a false positive costs one sign-in, a false negative costs an account.

The exception is a **60-second grace window**. Two refreshes racing on one
device, or a retry of a request whose response never arrived, present the same
token twice and are not an attack; without the window the honest case would
look identical to the dishonest one and lock a working phone out. The cost is
stated plainly: inside that minute a captured refresh token can be spent once.
The client holds up its end by refreshing single-flight, so the window is
defence against the network, not a routine occurrence.

## Email verification

**A native client requires a verified email. The web does not, and does not
start to.**

This is a deliberate divergence, and the reason to write it down is that
divergences drift. The web has never checked `email_verified`; making it start
would sign out or block people who have been using RecipeBox for months, which
rule one of this repository forbids. The native client has no users yet, so it
can be strict from the first build at no cost to anyone.

What "verified" means needs the same care. When verification was added, existing
rows were backfilled with `email_verified = true` so nobody was locked out —
the column therefore says "verified" about accounts nobody ever verified.
`email_verified_at` is NULL for exactly those rows, so the API reports both: the
flag, and whether anyone actually proved it. Reporting only the flag would be a
claim the data does not support.

Consequences:

- A **new** account created on the web and then used natively must confirm its
  email before the native app will issue it a token. It can still use the web
  app in the meantime, exactly as before.
- A **grandfathered** account signs in natively without re-proving anything.
  Demanding proof from someone who has been cooking from RecipeBox for a year
  would be a new obstacle dressed as security.
- Verification reuses what already exists — the `email_verification_tokens`
  table, the hashed single-use 24-hour token, Resend, and the web's
  `/api/auth/verify-email`. The native sign-in that is refused sends a fresh
  link on the spot, and the link is confirmed in a browser. No new
  infrastructure, no second verification path to keep in step.
- Where `RESEND_API_KEY` is absent (local development, CI, a preview) no email
  is sent and the response says `verificationEmailSent: false` rather than
  implying one went out.

## Token shape, and the tables

Opaque 256-bit random tokens, stored as a SHA-256 hash, in `device_sessions`
and `device_tokens` — not JWTs, and not in `account_sessions`. The reasoning is
in the design document; the part that belongs in an ADR is that a cookie value
and a bearer token must not be interchangeable, and separate tables make that a
schema impossibility rather than a code-review question.

A bare SHA-256 is correct here and a slow KDF would be pointless: the input is
256 bits of entropy, not a human-chosen password, so there is nothing to
brute-force.

## What this does not decide

- **Device management on the web.** The tables support it and "sign out all
  devices" is cheap, but it is web UI work, which rule one puts behind an
  explicit approval. The API is ready when the answer is yes.
- **Web session lifetime.** `SESSION_DAYS = 3650` is noted as not worth copying,
  and left alone: changing it is a live-behaviour change for real users.
