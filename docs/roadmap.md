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
- Request + cost hardening: replaced the blanket `50mb` JSON body limit with per-route limits — `1mb` default for all endpoints (auth, feedback, admin, etc.), `16mb` for `/api/ai` (image imports), and `40mb` for the recipe-sync routes (`/api/recipes`, signup, migrate) that carry a full library of base64 images. Oversized requests get a clean `413` JSON error. The global AI **wallet circuit breaker** (monthly estimated-cost ceiling) is now **ON by default at $75** (override/disable via `AI_MONTHLY_GLOBAL_MAX_COST_USD`) and now applies to everyone **except the master admin** — so it actually protects during the unlimited beta (beta users previously bypassed all global controls). Covered by `request-guards-test`.
- Share-to-import (Web Share Target): the manifest registers RecipeBox as a share target (`share_target`, GET, params title/text/url). Sharing a recipe link/text from another app opens RecipeBox at `/?url=&text=&title=`; the app parses it, routes to the right import tab (YouTube / social / web link / paste text), and opens the importer **pre-filled** (one tap to import — no surprise credit spend). Params are stripped from the URL after handling; if not signed in, the import opens right after sign-in. **Works on Android installed PWAs and is native-ready; iOS PWAs cannot be share targets, so it won't appear in the iOS share sheet until the native app** — but the same `/?url=` deep link works on any device (e.g. via an iOS Shortcut/bookmark) as an interim path.
- Share a recipe (native): the recipe detail action bar has a Share button that opens the OS share sheet (Web Share API) to send the recipe anywhere — Messages, Mail, Notes, etc. It attaches the branded PDF (with a short summary) when the platform supports file sharing, otherwise shares a clean plain-text version (title, servings, ingredients, directions, notes, "Shared from RecipeBox"); falls back to copy-to-clipboard / PDF download on browsers without the share API. Reuses the existing PDF builder (refactored to `buildRecipeDoc`). No per-recipe public link yet (recipes are private/account-scoped) — that'd need a public share page, noted as a future option.
- Import ingredient accuracy: all extraction (and JSON-repair) AI calls now run at temperature 0 so the model transcribes literally instead of paraphrasing/rounding ingredients (the main lever against half-and-half→milk on long, chatty transcripts). Plus a deterministic safety net: a high-signal ingredient list (half-and-half, heavy cream, buttermilk, evaporated/condensed milk, cake/bread flour, powdered/brown sugar, cornstarch, etc.) is compared between the YouTube/social source text and the extracted ingredients; if the source clearly names one that's missing from the recipe, a "double-check the ingredients against the original — the video mentions X" note is added (fires even on otherwise high-quality imports, only when there's a real mismatch). Covered by `import-fidelity-test`.
- Import ingredient fidelity: extraction prompts now explicitly forbid substituting/simplifying ingredients into more common equivalents (half-and-half must stay half-and-half; heavy cream/buttermilk/cake flour/etc. preserved exactly), with extra emphasis on noisy YouTube/social transcripts and instructions to keep the source's wording or note uncertainty rather than guess. The ingredient normalizer was confirmed to preserve identity (it keeps the source `name`). Thin YouTube/social imports (`sourceQuality` partial / description-only) now record `sourceQuality` + `importWarnings` on the recipe and prepend a "reconstructed from limited information — please review the ingredients" note (high-quality imports stay uncluttered). Regression test: `npm run import-fidelity-test`.
- Offline + instant launch (service worker): `public/sw.js` precaches the app shell (index.html, app.js, helper scripts, icons) plus the React/jsPDF/pdf.js/HEIC libraries, and serves them stale-while-revalidate — so the app opens instantly from cache and works offline. Offline you can browse/read saved recipes, meal plan, shopping list, use Cook Mode/timers, and export PDFs; AI/account actions show a clear "you're offline" message. `/api/*` stays network-first (fresh online, app falls back to its localStorage mirror offline). Versioned caches purge on activate; on an update a new worker activates and the page reloads once to apply it. **Bump `VERSION` in `public/sw.js` on each deploy** so updates roll out promptly. Deferred follow-up: a true offline write queue (edit offline → auto-sync on reconnect); today offline edits persist locally and sync on the next online save.
- Faster load (precompiled bundle): the app no longer ships ~3MB of `@babel/standalone` or compiles JSX in the browser on every load. The app source now lives in `src/app.jsx`, precompiled with esbuild to a ~214KB minified `public/app.js` (`npm run build:app`), loaded as a plain script. Dramatically faster cold load, especially on mobile. **Workflow change: edit `src/app.jsx` then run `npm run build:app` — do not hand-edit `public/app.js`, and the app code is no longer inline in `index.html`.**
- Standalone-PWA bottom seam fixed for real: the brand gradient is now a single oversized fixed `body::before` backdrop and every full-screen surface (splash, auth, cook mode) and `#root` is transparent — so there is only ONE gradient in the whole app and no seam where the home-indicator/safe-area strip met a second gradient box. HTML/JS are served `no-cache` so the installed PWA picks up updates.
- Nutrition + servings on import: extraction now always sets realistic servings (uses stated yield, otherwise estimates from quantities — never defaults to 4) and always fills per-serving macros (uses source nutrition when present, dividing whole-recipe values by servings; otherwise estimates from ingredients — never returns zeros). Recipe detail nutrition card gained a Per serving / Whole recipe toggle and hides entirely if a recipe genuinely has no macros.
- Native-feel UI polish: the app now reads as a native app, not a browser. Solid brand-green background fallback on html/body/#root + `overscroll-behavior: none` kill the white flash/line before splash and the rubber-band bounce; `maximum-scale=1, user-scalable=no` stops the iOS input-focus zoom; global `-webkit-tap-highlight-color: transparent`, `-webkit-touch-callout: none` on chrome (kept on inputs/recipe text), and antialiased font smoothing. Hover-lift is disabled on touch (`@media (hover:none)`) and replaced with a subtle press-scale; modals get momentum scrolling. Splash and auth screens use `100dvh` + safe-area padding. The PWA manifest already launches standalone with a brand background.
- Beta usage dashboard: App Control → Usage (master-admin only) shows real AI consumption to tune the tier credit numbers before launch — 30-day billable actions / provider cost / failures, all-time cost, a 14-day daily bar chart, a per-feature breakdown, the heaviest users this month, and a tuning line (avg/max billable actions per active user vs the Free 10 / Plus 100 / Family 250 / Founder 150 caps). Backed by `GET /api/admin/ai-usage-summary`. Read-only aggregation over `ai_usage_events`.
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

4. Improve social/video imports where source text is thin. **Recovery handoff added.**
   - When a YouTube or social import scrapes real caption/transcript text but the model can't structure a full recipe (thin source), the importer no longer dead-ends. It offers a one-tap **"Review captured text →"** that drops the scraped caption/transcript into Paste Text so the user can tidy and import it — deterministic, no extra AI/cost/privacy. Truly empty sources still show the honest fallback.
   - Still future: on-screen-text / video-frame OCR for caption-less TikTok/Shorts — evaluate only if cost and privacy are acceptable.

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
   - **Smart shortcuts ("Quick Finds") — Done.** The big 2-column "Collections" card grid was reframed into one compact, horizontally-scrollable **Quick Finds** chip row (it replaced both the old Popular Tags row and the heavy Collections grid — they were duplicative). Built only from tags the user actually has, frequency then alpha, each chip shows its count and taps through to the existing tag filter. Visually lighter than recipe/category cards.
   - **Library landing redesign — Done.** Recipe-first hierarchy: Header → Search → Quick filters → Quick Finds → Recently Saved → Browse your box → All Recipes. "Recently Saved" gives fast re-entry into the latest imports (shown only at ≥6 recipes so small libraries never feel empty). "Browse your box" now leads with categories that have recipes (by count); empty categories are collapsed behind "Show all categories" so empty scaffolding never dominates. Search now also matches category. Product direction: warmer than Paprika, more modern than Recipe Keeper.
   - **Remaining future enhancement:** richer smart collections like "Cook Again," "This Week," "From Your Pantry," "Saved from YouTube," "Family Favorites," and "Meal Prep"; plus letting users rename/merge their own tags and save custom collections. Future quick-filter placeholders documented: Planned, Cooked, Shared.

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

## Meal Planner

The Weekly Meal Plan is a single recurring week keyed by day name (`mealPlan = { Monday:[recipeId,…] }`), persisted to `/api/mealplan`.

- **Mobile polish pass — Done.** Calmer, recipe-first layout: a compact week-summary strip ("This week · <date range> · N meals · ~cal"), a dynamic Shopping List card (prominent "Ingredients from N planned meals" when meals exist; a muted "Generate after adding meals" hint when empty), a "Ready to plan your week?" prompt with Add-from-RecipeBox / Favorites / Quick shortcuts on an empty week, single-tap empty day cards ("Open night · Tap to plan dinner"; "What's for dinner tonight?" for today) instead of a dashed box + competing +Add, a softened Today highlight (inset green accent + pill instead of a thick border), planned rows with recipe thumbnails, and an upgraded add-picker (Favorites/Recent/Quick filters, thumbnails, safe-area padding, tap-scrim to dismiss). No data-model change.
- **Week navigation (future):** the plan is currently one recurring week with no dates. A real calendar with Previous / Today / Next would require date-keyed plan storage + migration — deferred.
- **Non-recipe entries (future):** real planning isn't always a recipe. Leftovers, eating out, freezer meals, and free-text notes need the day arrays to hold typed entries (`{type:'note'|'leftovers'|'eatingOut'|'recipe', …}`) instead of bare recipe ids, plus a migration — deferred to avoid a risky schema change.
- **Planned-row actions (future):** Move to… / Duplicate to… / Use leftovers tomorrow / Swap. (Open + Remove exist today; avoid drag-and-drop on mobile — prefer a simple action menu.)
- **"Help me plan" (AI, future):** an opt-in flow that proposes a full week for the user to **review before saving** (never auto-fill). Options: quick meals, family-friendly, pantry-first, budget-friendly, high-protein, avoid repeats. Consumes AI credits; always shows the plan for approval first.
- **Household / family (future):** assign who's cooking, "added by" labels, household notes, shared meal plans + shared shopping list, family preferences / kid-friendly planning. Pairs with the Family Plan subscription below.

## Shopping Lists

Deterministic, source-aware grocery lists built from one or more recipes. The engine is `public/shopping-list.js` (`RecipeBoxShopping`) — no AI in list generation.

- **Shopping is a primary app tab — Done.** Bottom nav is now Library · Plan · Shop · Pantry · Settings (short labels for the 5-tab fit, safe-area compliant). The Shop tab opens the shopping list directly, or a polished empty state (Add item / Choose recipes / Go to Meal Plan) when empty. The temporary Library "open shopping list" button was removed (redundant); the Library "Make a list" multi-select entry stays. Items are interactive: **tap the row to check/uncheck** (large targets), explicit **edit** (pencil) and **delete** buttons (no swipe-to-delete), and a tappable **source line** that expands the contributing recipes — each opens that recipe. Edits preserve checked state + source context.
- **Multi-recipe shopping lists — Done.** One combined, grocery-sectioned checklist from many recipes. (1) **Library multi-select** → "Create Shopping List"; (2) **Meal Plan** → "Generate Shopping List" from the week's planned recipes; (3) **Recipe detail** → "Add to my shopping list" (merges into the current list). Conservative consolidation (combines `1 cup + 1/2 cup sugar` → `1 1/2 cups`; **never** merges heavy cream / half-and-half / whole milk / buttermilk, different chocolates, or cheeses; keeps ambiguous units separate). Each item carries **source recipe context** (`item.sources` / `sourceCount`) and shows "Used in N recipes". A `ShoppingListScreen` provides check/uncheck (large tap targets), inline edit, delete, manual add, grocery-section grouping, a renamable title, and copy. List state (recipes + manual items + checked/edits/removed) **persists in `localStorage`** (`recipebox-shopping-v1`), user-specific and derived from the user's own recipes — no server route, no cross-user exposure. The single-recipe shopping view on recipe detail is unchanged.
- **Pantry-aware exclusion — Done (lightweight).** A pantry-staples inventory (normalized ingredient names, local-only, `recipebox-pantry-v1`): tap the pantry icon on any shopping item to mark "I always keep this on hand," and it's set aside in a collapsible "Already have · N" section and left off this and future lists (tap "Need it" to add one back). Matching is by exact normalized name, so it's conservative — "olive oil" as a staple won't exclude "extra virgin olive oil." No pantry **inventory UI/AI** beyond this; Pantry Chef stays chat-only.
- **Monetization framing:** Free = single-recipe shopping list + manual checklist. Plus = multi-recipe + meal-plan-generated list + ingredient consolidation + pantry-aware exclusion. Family = shared household list, real-time updates, shared pantry, "added by" labels.
- **Future:** a durable per-user/household `shopping_lists` + `shopping_list_items` model in Supabase (the local shape mirrors it); pantry-aware "already have / exclude pantry items" (no pantry **inventory** exists yet — Pantry Chef is AI chat only); household shared lists + real-time family sync + assign shopper; list sharing / export / print; store-aisle customization; AI-assisted grouping of genuinely ambiguous items (review-gated, never automatic); dedicated party/event lists; **serving/scale review before generating** and per-occurrence quantities when the same recipe is planned multiple times in a week (v1 counts each planned recipe once).

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

## Future: Swipe Navigation (back burner)

Swipe-to-navigate was tried on the web/PWA and disabled — it felt unreliable
(direction confusion, edge detection, color flash, conflicts with the browser's
own edge-swipe). **Fully removed now:** the `history.pushState`/`popstate`
back-navigation (which let the OS edge-swipe-back / Android back button drive
in-app screen/tab changes — the lingering "buggy swipe") is gone, along with the
dead swipe refs. Until native, RecipeBox uses **explicit buttons/menus only** —
no swipe navigation and no swipe-to-delete anywhere. Navigation is tap-driven
(bottom nav + in-screen back buttons) with directional slide transitions.

Revisit gesture navigation when building the **native iOS/Android** app, where
the platform provides reliable, interactive swipe-back (and a real page view
controller). Intended behavior to restore then: edge-initiated, interactive
finger-follow; recipe detail swipe-from-edge to go back; tab swipes only between
adjacent tabs with clamped ends. The disabled code/notes live in `src/app.jsx`.

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
