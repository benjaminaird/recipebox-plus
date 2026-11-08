---
status: accepted
date: 2026-10-16
---

# The web app becomes a secondary surface, not a retired one

When the native client (ADR 0001) ships, the existing Vercel web application
stays operational and keeps working against the same accounts, the same Neon
database and the same Recipes. It stops being where new product design happens;
the native app becomes the primary surface.

This was chosen over retiring the web app on native launch, and over maintaining
both as equal products. Keeping it alive costs almost nothing — it is already
deployed and working — and it removes the need for the native v1 to reach full
feature parity before it can launch at all. Retiring it stays available as a
later decision, made from a position of strength.

## Consequences

- **Native v1 does not need feature parity.** Deferred features must be written
  down explicitly, not silently dropped, and important user-facing functionality
  must be preserved somewhere the user can still reach it.
- Shared accounts and shared Recipes are a hard requirement: a person signing in
  on either surface sees the same library.
- The two clients will diverge in capability. Where the web app is the only
  place a feature exists (today: the master-admin console), that must be stated
  rather than discovered.
- Any change to the API or schema for the native client must keep the web client
  working. The web app is a live consumer with real users, not a legacy artifact.
