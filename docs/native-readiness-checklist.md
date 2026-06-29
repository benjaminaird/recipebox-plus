# Hearthkeep — Native / Mobile Readiness Checklist

Current as of the launch-readiness pass (2026-06-26). This is the **manual,
real-device QA checklist** — automated/headless mobile testing isn't available
in CI, so run this on a physical iPhone (and an Android phone if possible)
before any store submission. Code-level audit findings are noted inline.

Production: https://recipebox-kappa.vercel.app · deploys from
`codex/import-reliability-notes` via `vercel --prod` · service worker
`VERSION` is bumped on every deploy.

## Bottom navigation (now 5 tabs)
Order: **Library · Plan · Shop · Pantry · Settings**.
- [ ] All five labels fit without truncation on a small iPhone (SE/mini, ~320px). *Code: labels are short ("Plan"/"Shop"), `font-size 0.67em`, `flex 1 1 0`, `min-width 0` — fits at 320px.*
- [ ] The bar clears the home indicator. *Code: `paddingBottom: calc(env(safe-area-inset-bottom) + 8px)`.*
- [ ] Active tab is clearly indicated (color + gold underline).
- [ ] Tap targets feel comfortable; no accidental neighbor taps.
- [ ] No horizontal page scroll on any tab. *Code: `overflow-x: hidden` on html/body/#root.*

## Top safe areas
- [ ] Library, Plan, Shop, Pantry, Settings, Recipe Detail, Import headers don't overlap the clock / Dynamic Island / status bar. *Code: 23 `safe-area-inset`/`safePad` usages; recipe hero controls use `env(safe-area-inset-top)`.*
- [ ] Hero/gradient may extend behind the status bar, but tappable controls stay below it.

## No swipe / gesture regressions
- [ ] Swiping left/right does **not** navigate between screens or tabs.
- [ ] Swiping does **not** delete or check items.
- [ ] In-screen back buttons (Recipe Detail, Import, etc.) work.
- [ ] Android hardware-back / iOS edge-swipe: acceptable that it exits the app from a recipe rather than returning to the tab (deliberate — history-driven nav was removed). *Code: 0 active touch/pointer/popstate handlers; `pushState`/`popstate` fully removed.*

## Shopping tab
- [ ] Tapping an item row toggles checked; checked items fade and sink within their grocery section.
- [ ] Tapping **Edit**, **Delete**, the **pantry "have"** icon, or the **source line** does NOT toggle the item. *Code: row `onClick` guarded by `if (!editing)`; action buttons are in a separate container; source button `stopPropagation`.*
- [ ] Edit lets you change the text and preserves checked state + source context.
- [ ] Pantry "have" moves the item to the collapsible "Already have · N" section; "Need it" adds it back.
- [ ] Manual "Add item" works; the empty Shopping tab shows the polished empty state (Add item / Choose recipes / Go to Meal Plan).
- [ ] Source line "Used in N recipes" expands and each recipe title opens that recipe; back returns to the Shop tab.

## Meal Planner
- [ ] "Generate Shopping List" opens the Shop tab with the week's recipes; empty week keeps the disabled/empty state.
- [ ] Today highlight is clear but not heavy; day cards are single-tap when empty.

## Import + recovery
- [ ] A thin YouTube/social import shows the "Review captured text →" handoff (not a dead-end error) when caption/transcript text was scraped.
- [ ] The handoff drops the captured text into Paste Text for editing.

## Auth / account / email verification
- [ ] Sign up → a "Confirm your email" banner appears in Settings; the confirmation email arrives (Resend); tapping the link confirms in-app and clears the banner.
- [ ] "Resend confirmation email" works (rate-limited).
- [ ] Existing/beta accounts are NOT prompted to verify (grandfathered).
- [ ] Sign in, sign out, password reset still work; reset link expires/single-use.
- [ ] Export Backup downloads recipes + tags + meal plan + shopping list + pantry.
- [ ] Delete account requires "DELETE" + password, removes cloud data, and clears local device data.

## Service worker / cache
- [ ] After a deploy, the app picks up the new bundle (SW `VERSION` bumped; the page reloads once on update).
- [ ] Offline: saved recipes, meal plan, shopping list, Cook Mode still work; AI/account actions show the "you're offline" message.

## Security headers (verify in browser devtools → Network → document response)
- [ ] `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` present.
- [ ] `Content-Security-Policy-Report-Only` present. **Before enforcing CSP**, open the console on every flow (Library, import URL/YouTube/social/photo/PDF, AI Adjust, PDF export, images, sign-in) and confirm **zero CSP violation reports**. Then promote `Content-Security-Policy-Report-Only` → `Content-Security-Policy` in `vercel.json`.

## Native wrapper (Capacitor) — when starting the native pass
- [ ] App loads inside the Capacitor WebView (origin `capacitor://localhost` / `https://localhost`).
- [ ] Cookie session + CORS work from the native origin (sign in, sync, AI call).
- [ ] Safe areas correct on notch/Dynamic Island/small devices.
- [ ] iOS share extension for share-to-import (the one thing the PWA can't do on iOS).
- [ ] Decide payments: in-app purchase (StoreKit/Play Billing) for digital goods vs. web-only upgrades — required before selling in-app.
- [ ] Add Sign in with Apple only if other social logins are added.
