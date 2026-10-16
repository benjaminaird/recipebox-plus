---
status: accepted
date: 2026-10-16
---

# RecipeBox 2.0 is a native mobile client, not a wrapped web app

RecipeBox today is a React web application served from Vercel, with a Capacitor
shell under `native/everplate` that loads that web UI in a WebView. For
RecipeBox 2.0 the product owner has decided the mobile app must be a genuinely
native client with platform-appropriate navigation, gestures, transitions,
offline behaviour and device integration — iPhone first, Android as a planned
release platform rather than an afterthought.

**Explicitly rejected, and not to be revisited without a superseding ADR:**

- A Capacitor (or any WebView) shell around the existing website.
- Embedding the existing React web interface in a native container.
- A responsive/mobile restyle of the web app presented as the native product.
- Any "fastest path to the App Store" conversion that trades away native feel.

The existing web application remains the authoritative reference for *what
RecipeBox does* and stays in production until a native replacement is approved.
It is **not** the foundation for the new mobile UI. Its backend, database and
pure-JavaScript domain logic are reusable (see ADR 0003); its React web
front end is not.

The `native/everplate` Capacitor shell is historical. It carries the rejected
EverPlate brand and is superseded by this decision.
