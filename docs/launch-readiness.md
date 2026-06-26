# RecipeBox — Launch Readiness

Single source of truth for "what's done and what remains before public launch."
Last updated: 2026-06-26 (launch-readiness pass).

- **Production:** https://recipebox-kappa.vercel.app
- **Branch:** `codex/import-reliability-notes` (deploys to prod via `vercel --prod`)
- **Latest commit at this writing:** `fffbc23` (see `git log` for current)
- **Phase:** `LAUNCH_PHASE=beta` (beta = unlimited AI, abuse-rate-limited)

## 1. Current shipped features
- Recipe import: URL, YouTube, social, photo/handwritten card, screenshot, PDF, paste text. Multiple-recipe review screen. Thin-source recovery handoff into Paste Text.
- Library: search (title/category/tag/ingredient), Quick Finds chips, Recently Saved, category browse (filled-first), recipe cards, tags + smart tagging (Copycat etc.).
- Recipe detail: scaling, Cook Mode + timers, branded copyright-safe PDF export, native Share + share-to-import, original-source viewer for photo/PDF imports.
- Meal Planner: weekly plan, generate shopping list, mobile-polished.
- Shopping (primary tab): multi-recipe combined lists, conservative consolidation, source context, manual add, interactive checklist, pantry-aware "already have" staples.
- Pantry Chef (AI chat). Settings, App Control (master admin), feedback inbox.
- Offline + instant launch (service worker). Tap-only navigation (no swipe).

## 2. Security / privacy status — READY for web beta
- Headers (live): HSTS, `Cross-Origin-Opener-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, **CSP report-only**.
- **Action before enforce:** promote CSP report-only → enforced after on-device console QA (see native-readiness-checklist.md).
- SSRF guard on server-side import fetchers; per-route body-size limits; AI monthly cost circuit breaker ($75 default, master admin exempt).
- Data export (recipes/tags/meal plan/shopping/pantry) and account deletion (re-auth + transactional server delete + local wipe) live. Export is client-side from the user's own data only — no secrets/tokens/other-user data. Legal pages (privacy/terms/support/delete-account) live (**need final legal review before public**).

## 3. Auth / account status — READY
- scrypt + constant-time passwords; DB-backed sessions; DB-backed auth rate limiting (per IP+email, 20/15min); non-enumerating signin + reset.
- Password reset: hashed, single-use, expiring, rate-limited.
- **Email verification (new):** new signups get a confirmation email (Resend); hashed/single-use/24h tokens; verify + resend endpoints (rate-limited); Settings banner; existing accounts grandfathered verified. `npm run auth-verification-test`.

## 4. Payment / entitlement status — INFRA ONLY (not live)
- Tier config (Free/Plus/Family/Founder/Beta), `user_entitlements` (incl. stripe_* columns), `ai_credit_ledger`, server-enforced spend order. **No payments wired, no purchase UI, no ads.** Beta stays unlimited. emailVerified will gate payment actions when they ship.

## 5. AI credit + guardrails status — READY (beta)
- User-facing monthly credit ledger separate from provider logs; repair/cleanup passes are non-billable; failed calls cost zero. All enforcement server-side; no client can change credits/limits/cost.
- Import accuracy validated across Haiku/Sonnet/Opus → **Sonnet 4.5** is the model. Truncation auto-retry; conservative ingredient fidelity (no substitution); deterministic shopping-list generation (no AI). Deeper test harness + regression gate in `scripts/import-test`.

## 6. Import reliability status — READY
- Function/fetch timeouts, size caps, friendly failure copy, no credit charged on pre-AI failure. Thin social/video → honest fallback + recovery handoff. Weak spot remaining: caption-less TikTok/Shorts (would need video-frame OCR — future, cost/privacy-gated).

## 7. Native app / store readiness — NOT STARTED (web-first)
- Capacitor config exists; no wrapper built yet. See native-readiness-checklist.md for the Capacitor pass + store checklist (icons/screenshots, App Privacy labels, Sign in with Apple if other socials added, in-app purchase for digital goods).

## 8. Launch blockers (web beta)
1. **Final legal review** of privacy/terms (pages exist, content is placeholder-grade).
2. **Real-device QA** pass (native-readiness-checklist.md) on a physical iPhone.
3. **Promote CSP** from report-only to enforced after console QA confirms no violations.
4. Confirm `RESEND_API_KEY` / `RESEND_FROM` set in prod so verification emails actually send (password reset already uses it).

## 9. Nice-to-have polish (not blockers)
- Richer smart collections ("Cook Again", "This Week", "Recently Cooked").
- Durable server-backed shopping list; family shared lists; full pantry inventory.
- Per-occurrence meal-plan quantities; serving/scale review before generating a list.

## 10. Known limitations (carry forward)
- Shopping list + pantry staples are **localStorage, local-only** (durable server/household model deferred).
- Pantry is lightweight **staples**, not a full inventory; exclusion matches exact normalized names.
- A recipe planned on multiple meal-plan days counts **once** in the generated list.
- No native wrapper yet; payments not live; legal docs need final review.
- CSP shipped **report-only** (not yet enforced).
- Android hardware-back/iOS edge-swipe exits from a recipe rather than returning to the tab (deliberate, to remove buggy swipe).

## 11. Test suite (run before release)
`shopping-list`, `meal-plan`, `library-view`, `recipe-tags`, `import-fidelity`,
`import-reliability`, `notes-import`, `entitlements`, `ai-credits`,
`request-guards`, `auth-rate-limit`, `auth-verification`, `security-headers`,
`youtube-parser`, plus `node -c server.js`, `node --check public/app.js`, and
`npm run build:app`. (`smoke-test`/`security-smoke-test` need a running
DB-backed server.)
