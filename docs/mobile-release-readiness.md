# Hearthkeep Mobile Release Readiness

This document tracks the infrastructure needed to ship Hearthkeep through the
Apple App Store and Google Play.

## App Identity

- App name: Hearthkeep
- iOS bundle ID: `com.recipeboxapp.recipebox`
- Android package ID: `com.recipeboxapp.recipebox`
- Primary domain: `recipeboxapp.com`
- Production web app: `https://recipebox-kappa.vercel.app`
- Support email: `hello@recipeboxapp.com`

## Current Pass Completed

- Added public support, privacy, terms, and account deletion pages:
  - `/support.html`
  - `/privacy.html`
  - `/terms.html`
  - `/delete-account.html`
- Added Settings links for those pages so users and reviewers can find them
  from inside the app.
- Added `public/app-config.js` and an API base helper in the frontend. This
  keeps normal web calls relative, but allows future native shells to call the
  production API host explicitly.
- Added credential-aware API fetches plus trusted-origin CORS/session-cookie
  support for future native shells.
- Added `capacitor.config.json` with the planned app ID, app name, web
  directory, splash color, and keyboard behavior.
- Improved the web manifest with app ID, language, categories, and display
  fallback metadata.

## Held For Next Pass

- Install Capacitor packages and generate native `ios/` and `android/`
  projects.
- Decide whether native beta builds should bundle the static app or load the
  production Vercel app. Bundled is more app-like; hosted is faster to update.
- Add native permission descriptions:
  - Photo library/file picker for recipe images and PDFs.
  - Camera only if direct capture is added.
  - Notifications only if timer alerts become local notifications.
- Add App Store Connect and Google Play Console assets:
  - Phone screenshots.
  - Tablet screenshots if supporting tablets at launch.
  - Feature graphic for Google Play.
  - App preview video only if useful.
- Add native in-app purchase scaffolding. Do not add live payments until plan
  and entitlement logic is finished.
- Add Apple Sign In and Google Sign In.
- Add crash reporting and privacy disclosures for diagnostics if enabled.
- Add Universal Links and Android App Links after store/team IDs and signing
  fingerprints exist.

## Store Listing Draft

Short description:

Hearthkeep saves family recipes, imports recipes from links and photos, and
helps you cook with clean recipe cards, timers, and meal planning.

Full description draft:

Hearthkeep is a warm, practical home for your personal recipes. Save family
favorites, import recipes from links, YouTube videos, captions, photos, PDFs,
and screenshots, then turn them into clean recipe cards you can actually cook
from.

Key features:

- AI-assisted recipe import and cleanup.
- Recipe cards with ingredients, steps, photos, categories, and notes.
- Cook Mode with step-by-step directions and cooking timers.
- Pantry Chef for dinner ideas from what you have on hand.
- Weekly meal planning.
- Account sync for access across devices.
- Backup export for your recipe collection.

Hearthkeep works best with clear recipe text, public posts that include recipe
captions, and photos or PDFs where the recipe is readable.

## Data Safety Notes

Expected disclosures for Apple and Google:

- Account info: email address and display name.
- User content: recipes, meal plans, uploaded images, PDFs, screenshots, pasted
  text, links, and captions.
- App activity: AI request counts and account/session activity needed to run the
  service.
- Diagnostics: none intentionally collected today, unless added later.
- Data is used for app functionality, sync, support, abuse prevention, and AI
  recipe processing.
- Data is not sold.

## Native API Configuration

The browser app uses relative API calls by default. Native shells can override
that by setting:

```js
window.RECIPEBOX_CONFIG = {
  apiBase: "https://recipebox-kappa.vercel.app"
};
```

This is intentionally isolated in `public/app-config.js` so the native build
can swap the API target without editing recipe features.
