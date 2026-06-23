# RecipeBox Roadmap

RecipeBox is moving toward beta-readiness first, then wider iOS and Google Play release. The product direction is a household food-management system: recipe saving, intelligent organization, AI-assisted adaptation, meal planning, shopping lists, and family coordination.

## Near-Term Beta Priorities

- Keep recipe import reliable across links, YouTube, social captions, images, screenshots, and PDFs.
- Improve deterministic shopping-list generation without extra AI calls at list-open time.
- Keep mobile layouts compact, readable, and safe for native wrapping.
- Continue production security, privacy, and account-readiness work.
- Keep AI credit behavior simple, fair, and trust-first: users should never lose extra credits because RecipeBox needed hidden detection, cleanup, or JSON repair passes.

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
