# RecipeBox Roadmap

RecipeBox is moving toward beta-readiness first, then wider iOS and Google Play release. The product direction is a household food-management system: recipe saving, intelligent organization, AI-assisted adaptation, meal planning, shopping lists, and family coordination.

## Current Status

Last updated: June 23, 2026.

- Production is deployed at `https://recipebox-kappa.vercel.app` (Vercel production target, aliased; deployed from the `codex/import-reliability-notes` branch via `vercel --prod`).
- Latest checkpoint branch: `codex/import-reliability-notes`.
- Latest checkpoint commit: `c52da90 Add multiple-recipe import review screen` (live in production).
- The multiple-recipe import review screen is shipped: when extraction returns `multiple_recipes_detected`, the user sees the detected recipes and can import one, combine them into a single card, or import all separately. Each option re-runs a focused extraction against the original source and discloses that it uses AI credits. All AI calls still go through `/api/ai`, so server-side credit metering and tier/rate-limit enforcement are unchanged.
- Import reliability is much stronger across URLs, YouTube, PDFs, photos, HEIC uploads, scanned PDFs, and sideways PDF pages.
- The private 35-case import suite from the Desktop testing document passed locally. The repo keeps that suite local/ignored so personal recipe photos, PDFs, and notes are not pushed.
- A safe committed import harness now exists with synthetic fixtures for non-private regression checks.
- Recipe notes are now part of imported and edited recipes, shown above ingredients/directions, and source URLs in notes are clickable.
- Shopping lists now use deterministic local aggregation and grocery categories instead of another AI call.
- Known honest fallbacks are now part of the expected product behavior: blocked recipe pages, low-information social/video sources, and multiple-recipe sources should not become invented or silently merged recipes.
- Beta feedback (Settings → Beta Feedback) is now readable: a master-admin-only inbox in App Control shows each message with submitter, page, and device, supports new/reviewed triage, and surfaces an unread badge on the Settings tab and App Control card. Stored in `user_feedback`; no email/webhook — visible only to the master admin (server-enforced).
- First-run onboarding: an empty RecipeBox now shows a warm "Welcome to your RecipeBox" card with clear, tappable "ways to add" tiles (Import from the web / Snap a photo or card / Paste recipe text — each opens the right import tab) plus an "Ask Pantry Chef" option and a sync reassurance line. The empty category grid and redundant filter chips are hidden until the first recipe exists. No fake/sample recipes are injected.
- Auth hardening: sign-in/sign-up/password-reset throttling is now DB-backed (`rate_limit_counters`, per IP+email, 20 / 15 min) instead of an in-memory map, so brute-force protection actually holds across serverless instances (the in-memory map remains a local-dev fallback). Passwords use scrypt + constant-time compare, reset tokens are hashed/single-use/expiring, and sessions are DB-backed — all already solid. (Email verification on signup remains a future item.)
- Monetization/entitlement infrastructure is in place (server-side, source of truth): tier config (Free/Plus/Family/Founder/Beta), an `ai_credit_ledger` for non-monthly buckets (purchased + bonus), and `/api/ai` now enforces a credit balance and spends monthly → bonus → purchased. We are in `LAUNCH_PHASE=beta`, so beta stays unlimited (with abuse rate limits) and the tier caps are inert for current users until launch. No payments/ads wired. See the Monetization milestone below.

## Import Reliability (hardening pass — done)

- Raised the Vercel function `maxDuration` to 60s (`vercel.json`). The default (~15s) was too short for large photo/PDF/vision extractions (often 20–40s), so those imports were timing out at the platform layer. This is the biggest single import-reliability fix.
- All external fetches (recipe pages, YouTube oembed/page/captions, social oembed/metadata, and the Anthropic call) now use `fetchWithTimeout` with hard timeouts (7–9s for sources, 55s for the model) so a slow/hanging source fails fast with a clear message instead of stalling the whole request.
- `readBodyCapped` bounds response bodies (~6MB) so an oversized/malicious page can't exhaust memory; non-HTML links are rejected with a friendly message.
- Honest, specific errors: timeouts → "took too long…", unreachable → "could not reach that page…", too-large/non-readable → "not a readable recipe page…", each pointing to Paste Text / screenshots. Zero credits are charged on any pre-AI fetch failure or AI timeout (verified by design: the model is only debited on success).
- SSRF protection: user-supplied import URLs (`/api/fetch-url` and the social generic-page fallback) now go through `safeFetch`, which resolves the host and blocks loopback, private, link-local (incl. cloud metadata `169.254.169.254`), CGNAT, and reserved ranges — and re-validates every redirect hop (`redirect: manual`). Blocked links return a clean "can't be imported" message; public recipe sites are unaffected. YouTube/social platform calls use fixed trusted hosts.
- Covered by `npm run import-reliability-test` (timeout aborts promptly, size cap, abort detection, private-IP/host blocking).

## Near-Term Beta Priorities

- Keep recipe import reliable across links, YouTube, social captions, images, screenshots, and PDFs.
- Improve deterministic shopping-list generation without extra AI calls at list-open time.
- Keep mobile layouts compact, readable, and safe for native wrapping.
- Continue production security, privacy, and account-readiness work.
- Keep AI credit behavior simple, fair, and trust-first: users should never lose extra credits because RecipeBox needed hidden detection, cleanup, or JSON repair passes.

## Next Recommended Steps

1. ~~Build the multiple-recipe import review screen.~~ **Done (c52da90).** Detected recipes are shown with import-one / combine / import-all options and a credit disclosure before any paid extraction. Possible follow-ups: let the user preview a recipe before committing the paid re-extraction, and add a private-suite case that exercises the selection flow end to end.

2. ~~Add original source preservation for photo/PDF imports.~~ **Done.**
   - Photo/image imports (handwritten cards, family photos, screenshots) and scanned PDFs now save a lightweight `originalSource` on the recipe: up to 4 pages, each re-compressed to ~1280px JPEG q0.7 so payloads stay small. It rides in the per-user `recipe_json` JSONB (no schema/API change).
   - Recipe detail shows a warm "See the original recipe card / pages" entry (with a thumbnail) that opens a full-screen viewer of the imported image(s)/page(s).
   - Preserved through the multiple-recipe review selections (one/combine/all) via the captured extraction context, and through normal edits (deep-cloned draft). The original-source blob is stripped from AI editor/adjust prompts (saves credits) and is kept out of the localStorage mirror to avoid quota failures — it persists on the server for signed-in users and is included in full JSON exports/backups.
   - Known follow-ups: text-based PDFs (where we extract text instead of rendering pages) do not yet capture an original image; scanned single/double-page PDFs may archive the rotation-augmented page set, so the viewer can show an extra rotated copy.

3. ~~Add real user-visible AI credit ledger behavior.~~ **Done.**
   - User credits and provider-call logs are now cleanly separated. `ai_usage_monthly` holds the user-facing credit count; `ai_usage_events` holds every provider call with token counts and estimated cost (admin-only).
   - **Fair counting:** internal JSON-repair/cleanup passes are classified as a `repair` feature and are non-billable — they are still logged for admin cost visibility but never consume a user credit, and are not blocked by the monthly cap (so a repair tied to an already-billed import can't fail the import). Failed/blocked calls cost zero credits.
   - **User ledger:** `GET /api/me/ai-ledger` (auth-required, scoped to the signed-in user) returns the monthly usage plus recent user-facing activity (friendly labels, 1 credit per completed action, "No charge" for failures). Provider cost and token counts are never exposed to users. Surfaced in Settings → "AI Credits" with a fair-use promise and an expandable "recent activity" list.
   - **Admin signals:** the admin user list now shows provider cost ($), hidden repair-pass count, and failed-call count per user alongside the AI call count.
   - Covered by `npm run ai-credits-test` (feature classification + billable/non-billable). No client can change credits/limits/cost — all enforcement stays server-side.

4. Improve social/video imports where source text is thin.
   TikTok and Shorts often need on-screen text or frame understanding. Until that exists, keep the honest fallback. Later, evaluate video-frame OCR/transcription only if cost and privacy are acceptable.

5. Mobile/native readiness pass. **First pass done.**
   - Audited the surfaces shipped in this work plus core chrome against phone layouts (code-level review; the modal/sheet system, safe-area insets, and `dvh`/`NAV_CLEARANCE` conventions were already in place from earlier commits).
   - Touch targets: clickable tag chips now have a comfortable ~34px tap height in the Popular Tags row and recipe detail, a compact ~28px variant on dense library cards, plus `touch-action: manipulation`; the "+N more" and original-viewer Close controls were enlarged.
   - The Original Recipe Card full-screen viewer got momentum/contained scrolling and a larger Close target (it already used safe-area padding).
   - Cook Mode now uses `100dvh` (fixes iOS URL-bar overflow) and bottom safe-area padding so the Back/Next/Done controls clear the home indicator.
   - Verified the multiple-recipe review modal and Category modal inherit the existing `≤560px` bottom-sheet behavior (scrollable, safe-area-aware).
   - **Not yet done:** real on-device/emulator testing (no headless browser in this environment), and a deeper polish pass on the auth/splash screens. Recommend a quick physical-device spot-check before native wrapping.

6. Keep expanding the private import suite.
   Add more URLs, YouTube links, PDFs, HEIC photos, screenshots, and handwritten cards. Mark expected impossible cases explicitly so trust-first fallback stays green.

7. ~~Tag-based filtering / smart collections (e.g. "Copycat").~~ **Done (tag system v1).**
   - Tag chips are now clickable on library cards and recipe detail; tapping one filters the Library to that tag with a clear "Showing recipes tagged X" banner and a Clear control. Works on mobile.
   - A "Popular tags" row sits below the Library search, built from the user's own recipe tags (no global tag table), de-duplicated by normalized key and sorted by frequency then alphabetically, capped at 8 with a "+N more" expander.
   - Tag filtering is case-insensitive and separate from text search and category filtering. A shared `public/recipe-tags.js` (`RecipeBoxTags`) normalizes/de-duplicates casing variants (e.g. copycat/CopyCat → "Copycat"), Title-cases display, and caps tags at 12. Normalization runs on every create/update; conservative evidence-based suggestions run on create.
   - **"Copycat" is a tag/smart-discovery concept, never a category.** Categories remain real food types (Breakfast, Entrées, Desserts, etc.). Import/AI now suggests `Copycat` when the title/source clearly indicates a restaurant/brand recreation ("copycat", "restaurant-style", "better than takeout", "<Brand>-style/inspired"), plus a conservative curated set (Quick, Weeknight, Air Fryer, Slow Cooker, Instant Pot, One-Pot, No-Bake, Grill, Make-Ahead, Meal Prep, Freezer-Friendly, Holiday, Party, Budget-Friendly, Kid-Friendly, Comfort Food, Spicy). Diet/allergy tags (Vegan, Vegetarian, Gluten-Free, Dairy-Free) are only added when explicitly stated, never inferred. The tag is descriptive only — no official affiliation or brand logos.
   - Covered by `npm run recipe-tags-test`. No schema/API change (tags still live in the per-user `recipe_json` JSONB, same ownership/privacy/RLS).
   - **Remaining future enhancement:** curated smart collections such as "Copycat Favorites," "Weeknight Wins," or "Meal Prep" (saved/auto-built collections surfaced on the dashboard), and optionally letting users rename/merge their own tags.

8. Tag backfill + branded, copyright-safe PDF export. **Done.**
   - Settings → "Tag your library" runs the deterministic tag suggester over existing recipes (non-destructive merge, de-dupe, never removes user tags, no AI calls), so recipes saved before the tag system become filterable.
   - PDF export now includes the recipe Notes (where source links/attribution live), and every page carries a copyright-safe footer: RecipeBox branding, a "personal use · original recipe rights remain with their authors" line (or "Imported from <source>" when a `sourceUrl` is present), and page numbers.

## Near-Term AI Credits Policy

AI credits should reflect user-approved outcomes, not internal implementation details.

- One normal import attempt should cost one user-visible credit, even if RecipeBox uses small internal detection, cleanup, or repair calls.
- If RecipeBox cannot read a source before calling AI, such as a blocked recipe page, it should cost zero user credits.
- If an import clearly fails during beta, prefer zero user credits or an automatic refund over making users feel charged for broken behavior.
- If a photo/PDF appears to contain multiple recipes, RecipeBox should pause and ask:
  - Import one recipe: one credit.
  - Treat as one recipe: one credit.
  - Import both/all recipes: one credit per created recipe, clearly disclosed before running.
- Internal provider calls, token usage, and estimated cost should still be logged for admin visibility and abuse/cost control.
- Future implementation should split user-visible credit ledger from provider API-call logs so fairness and cost monitoring can both be true.

## Future Import Preservation: Original Recipe Cards

RecipeBox should preserve sentimental source material for family recipes while still making the cleaned recipe easy to cook from.

- When a recipe is imported from photos, handwritten cards, screenshots, or PDFs, optionally save the original source with the recipe.
- Recipe detail can show a small "Original Recipe Card" or "Let's see what the original says" entry near Notes or under the hero image.
- Tapping the entry should open a simple full-screen viewer for the original image/PDF page.
- The original source should act as a source of truth for edits and as a sentimental keepsake.
- Edit Recipe should allow adding, replacing, downloading, or removing the original source.
- Keep the first implementation lightweight; avoid complex OCR history/versioning until import reliability is stronger.
- Long term, store originals in Blob/object storage rather than large base64 fields in recipe JSON, especially for multi-page PDFs and high-resolution iPhone photos.

## Future Monetization: Referral Program

Users should eventually be able to refer a friend and receive a one-time AI credit bonus when the referred friend completes a qualifying signup or conversion event.

- Referral code/link per user.
- Qualifying conversion grants credits to both accounts.
- Credit grants must be server-side only, never client-controlled.
- Track referrer, referred user, referral source, qualification date, granted credits, and audit events.
- Prevent self-referrals and repeated bonuses from the same referred user.
- Later abuse checks may include device, IP, and payment-method review.
- Possible future tables: `referrals`, `ai_credit_ledger`, `referral_events`.

## Future Native Apps: iOS / Android Widgets

Widgets should help users make useful food decisions without opening the app.

- Tonight's Meal: today's planned dinner with deep links to recipe, Cook Mode, and missing ingredients.
- Shopping List: next unchecked items with a deep link to the full list; interactive check-off can wait until native support is clean.
- Quick Import / Add Recipe: deep link to clipboard, URL, scan/photo, or manual recipe creation.
- Pantry Chef: "What can I make?" entry point using current pantry/library context.
- Cook Mode: current active recipe step or quick access to a recently planned recipe.

This belongs after native wrapping and release planning. Avoid app architecture choices that would make widgets difficult later.

## Future Subscription: Family Plan

Recommended cap: 4 members.

- Roles: Owner, Adult, Member.
- Owner controls billing and invites.
- Shared library, favorites, meal plans, shopping lists, and pantry.
- Personal/private recipes remain private unless explicitly shared.
- Household sharing should be permission-based, not a shared login.
- Do not require members to live in the same household; support roommates, couples, separated families, college students, and caretaking relationships.

## Future Polish: PDF Export

Recipe exports should feel polished, branded, and worth sharing.

- Add RecipeBox branding and logo if available.
- Improve title hierarchy and typography.
- Add metadata chips for servings, prep time, cook time, total time, category, and rating.
- Use clean ingredient, directions, and estimated nutrition sections.
- Footer: "Exported from RecipeBox."
- Avoid imported recipe photos by default unless ownership/licensing is clear.
- If image inclusion is added, make it optional and default off.
- Use warm RecipeBox styling: cream, deep green, soft gold, and walnut accents.

## Milestone: Monetization & Entitlements

Tiers: **Free, Plus, Family, Founder, Beta.** All values are server-side and never client-trustable.

Built now (server-authoritative):
- Central config (`ENTITLEMENT_CONFIG` / `PLAN_ENTITLEMENTS`) for tier names, monthly credits, placeholder pricing, credit packs, referral amounts/cap, family member cap (4), an ads-enabled flag (default off, no ad network), and credit rules.
- Monthly included credits: Free 10, Plus 100, Family 250 (shared — see below), Founder 150, Beta unlimited during beta. `LAUNCH_PHASE` flag (`beta` | `launched`) controls whether beta is unlimited; defaults to `beta`.
- `ai_credit_ledger` table for non-monthly buckets (`purchased`, `bonus`) with debits; monthly usage stays in `ai_usage_monthly`. Purchased and bonus credits never expire; monthly does not roll over.
- `/api/ai` checks total remaining (monthly + bonus + purchased) before calling the model and debits one credit in spend order **monthly → bonus → purchased**. Internal repair passes remain non-billable. Beta is unlimited but still IP + per-user daily abuse-rate-limited.
- `GET /api/me/credits` (auth) returns plan, monthly used/remaining/reset date, bonus, purchased, total. `GET /api/config/entitlements` exposes read-only display config. `POST /api/admin/credits/grant` (master-admin) grants bonus/purchased credits manually until billing exists. Settings shows plan, remaining, bonus/purchased, reset date, and a "coming soon" note (no fake purchase buttons).
- Referral foundation: `grantReferralBonus()` grants 25 credits to each side, capped at 10 paid conversions per referrer per month (`referralBonusAllowed`). Not yet wired to a live conversion event.

Pricing placeholders: Plus $4.99/mo or $39.99/yr; Family $7.99/mo or $69.99/yr; Founder $29.99/yr forever (beta converts only, 150 credits/mo after launch). Packs: 25/$1.99, 75/$4.99, 200/$9.99, 500/$19.99.

Documented for later (not built now):
- **Payments**: Stripe (and later App Store / Play billing). `user_entitlements` already has `stripe_customer_id`/`stripe_subscription_id` columns. On a successful subscription/purchase webhook: set the plan or write a `purchase` ledger grant. No billing UI or purchase buttons until this is live.
- **Founder conversion workflow**: at launch, offer beta users Founder ($29.99/yr forever, 150/mo). Mark eligibility, capture conversion, set plan `founder`.
- **Family household sharing**: Family tier config exists (250 credits, cap 4) but sharing is not enforced. Build a household model (owner/adult/member, invites, shared library/meal-plan/shopping-list/pantry, private-by-default recipes) and make the 250 credits a shared household pool. See "Future Subscription: Family Plan".
- **Referral end-to-end**: per-user referral code/link, self-referral and duplicate-referred protection, conversion detection tied to payments, audit events. Possible tables: `referrals`, `referral_events`. See "Future Monetization: Referral Program".
- **Optional free-tier ads**: keep the `adsEnabled` config and entitlement shape ready; do not integrate an ad network unless we choose to.
- **App Control entitlement UI**: a master-admin screen to view/edit tier config, grant credits, and inspect ledgers (extend the existing admin endpoints; keep all enforcement server-side).
- **Feature gates by tier**: AI features are already credit-gated. Non-AI gates (e.g. PDF export / meal planning as Plus perks) are encoded in config but not enforced during beta; enforce at launch if desired without breaking current users.

## Milestone: Desktop / Web Companion (recipeboxapp.com)

A responsive desktop/web experience sharing the same account, sign-in, and synced recipe data as mobile.

- Start as a **web app / PWA**, not a downloadable Mac/PC app. Packaged Mac/Windows wrappers can be optional future add-ons if demand exists.
- Desktop is prioritized for the heavier workflows: import review, editing, organizing, **batch imports**, source preservation, PDF/card/photo review, printing/export, meal planning, and household management.
- Same Postgres-backed account and recipe sync; no separate data model.
- Reuse the existing API; build a desktop-optimized layout (multi-column, keyboard-friendly) rather than stretching the mobile layout.

## Milestone: Local Source Archive (optional desktop feature)

A future competitive advantage and storage-cost control feature — not a launch blocker.

- Cleaned recipe data continues to sync through the cloud as today.
- Large **original source files** can stay local on the user's desktop: original recipe-card scans, cookbook photos, screenshots, imported PDFs, and raw source images. (Today the lightweight original-source archive is cloud-stored and compressed; this milestone adds an optional larger local-only tier.)
- The UI must clearly distinguish cloud-synced recipe data from local-only original archive files.
- Mobile still shows the usable recipe and source info, but may indicate that full-resolution original source files are available only on desktop.
- Needs a sync/ownership model that tracks which originals are cloud vs local, and graceful handling when a desktop is offline.
