# EverPlate native handoff

Status: native packaging and shared-product architecture are implemented on `codex/everplate-native-brand`. The project is ready for local iOS/Android development and unsigned build validation. Public beta/release is intentionally blocked on approved vector brand artwork, Apple/Google accounts, signing, store records, and final legal URLs.

## Architecture and RecipeBox protection

EverPlate is a Capacitor 8 native shell around the proven responsive application. This phased approach retains the tested RecipeBox mechanics and API contracts while providing native lifecycle, dialogs, share sheets, file sharing, haptics, keyboard handling, network state, status bar, deep links, and Android back behavior. A React Native rewrite was rejected because it would duplicate or rewrite the monolithic, proven application core and materially increase data/import/save risk.

`src/product-config.js` is the single product switch. `public/app-config.js` selects RecipeBox by default. `scripts/build-product.js everplate` emits a separate, ignored `dist/everplate` bundle with EverPlate config. `native/everplate/capacitor.config.json` consumes only that bundle. RecipeBox continues to build into `public` and continues to use the root `capacitor.config.json`.

Never edit these files for an EverPlate-only branding change:

- `capacitor.config.json` (root RecipeBox native/PWA configuration)
- `.vercel/project.json` (ignored local link to the `recipebox` Vercel project)
- `public/index.html`, `public/manifest.webmanifest`, `public/sw.js`, or RecipeBox icons
- database schema, migrations, authentication identifiers, or current API paths

Change shared mechanics only in `src/app.jsx`, with product-dependent behavior routed through `src/product-config.js`. Change native-only behavior under `native/everplate`.

No database migration is part of this work. The only backend compatibility change is allowing `X-App-Client`, `X-App-Version`, and `X-Request-Id` in CORS preflight headers.

## Identity and configuration

| Value | EverPlate |
|---|---|
| Display name | EverPlate |
| Version | 1.0.0 |
| iOS build number | 1 |
| iOS bundle identifier | `com.benjaminaird.everplate` |
| Android package | `com.benjaminaird.everplate` |
| Android version code | 1 |
| Deep-link scheme | `everplate` |
| Native client header | `everplate-native` |
| API base | `https://recipebox-kappa.vercel.app` by default |
| Analytics product identifier | `everplate-native` (reserved; no analytics SDK added) |

The build accepts `EVERPLATE_API_BASE`. It must be an HTTPS origin, except that HTTP localhost is accepted for development. No secrets belong in this variable or in the client bundle.

Capacitor serves the app at `https://localhost`. The existing backend already accepts HTTPS localhost origins. Authentication remains the existing HTTP-only secure session cookie. Capacitor's native HTTP and cookie bridges are enabled so tokens are not copied into localStorage or other plain-text application storage. EverPlate caches only the non-secret public account profile for understandable offline launch; the secure cookie remains authoritative and is revalidated on resume.

Password-reset and verification routes are accepted through `everplate://reset?token=…`, `everplate://verify?token=…`, or query-bearing links opened by the app. Existing email messages still point to RecipeBox web URLs. Changing those links requires a real EverPlate web/universal-link domain and backend configuration; that is a manual post-domain task.

Temporary links, pending dedicated EverPlate pages:

- Support: `https://recipebox-kappa.vercel.app/support.html`
- Privacy: `https://recipebox-kappa.vercel.app/privacy.html`
- Terms: `https://recipebox-kappa.vercel.app/terms.html`
- Account deletion: `https://recipebox-kappa.vercel.app/delete-account.html`

## Design tokens

Light:

- Primary deep green `#274233`; primary dark `#1B2E26`; primary light `#6C816E`
- Sage `#A6B3A0`; brass `#CB9A4E`
- Ivory `#FAF7F0`; elevated cream `#F2EFE7`; paper `#FFFFFF`; border `#E0DED6`
- Charcoal `#1C1D1B`; secondary `#545852`; muted `#7A7F7B`
- Success `#3E7A5A`; warning `#C6922E`; error `#B4483C`

Dark:

- Background `#0F1412`; surface `#1E221F`; card `#242B26`; border `#2E3632`
- Primary text `#FAF5F2`; secondary `#B8BEBA`; muted `#8F9491`; brass `#CB9A4E`

Display and recipe typography uses locally packaged Lora. Interface and long-form body typography uses locally packaged Source Sans 3. System serif/sans fallbacks remain available.

## Asset inventory and release blocker

The supplied brand board is a raster presentation, not approved vector art. Its circular breaks, exact E glyph, kerning, and wordmark curves cannot be reproduced faithfully from the screenshot. No screenshot crop or upscaled board fragment is used.

The following are explicitly temporary, code-native placeholders with embedded `asset-status=temporary-placeholder` metadata:

- `public/brand/everplate/monogram-placeholder.svg`
- `public/brand/everplate/wordmark-placeholder.svg`
- `public/brand/everplate/wordmark-light-placeholder.svg`
- `public/brand/everplate/monochrome-placeholder.svg`
- `native/everplate/assets/logo.svg` and `logo-dark.svg`
- generated iOS icon/splash and Android legacy/adaptive/monochrome/splash assets

Before TestFlight, Play internal testing, marketing capture, or public release, obtain approved vector masters and replace:

1. Monogram master with exact open-circle geometry and final E letterform.
2. Primary wordmark with final custom kerning/outlines.
3. Light, dark, and monochrome variants.
4. A 1024×1024 opaque iOS/store icon master with safe margins.
5. Separate Android adaptive foreground, solid background, and one-color monochrome masters.
6. Light and dark launch marks/wordmarks sized for native splash canvases.

Then run `npm --prefix native/everplate run assets`, inspect every generated size/mask, and rerun all validation. No notification asset is included because the application has no notification feature or permission.

## Local prerequisites and commands

- Node.js 22 or newer (Capacitor 8 requirement)
- Xcode 26+ with an installed iOS platform
- Android Studio/current SDK and Java 21 (this machine currently has no Java runtime)
- CocoaPods is not required; this project uses Swift Package Manager

Install and build:

```bash
npm install
npm --prefix native/everplate install
npm run build:recipebox
npm run build:everplate
npm run native:everplate:sync
```

Open for development:

```bash
npm run native:everplate:ios
npm run native:everplate:android
```

Unsigned iOS compile check:

```bash
npm --prefix native/everplate run build:ios:preview
```

iOS internal archive (after choosing an Apple team/signing identity in Xcode):

```bash
npm run native:everplate:sync
npm --prefix native/everplate run build:ios:everplate-internal
```

Android debug APK (after installing Java 21/Android SDK):

```bash
npm run native:everplate:sync
npm --prefix native/everplate run build:android:preview
```

Android internal AAB:

```bash
npm run native:everplate:sync
npm --prefix native/everplate run build:android:everplate-internal
```

`development`, `preview`, `everplate-internal`, and `everplate-production` are exposed as named npm build profiles. Capacitor/Xcode/Gradle are the repository-appropriate build system, so EAS is not configured.

## Apple handoff checklist

1. Replace all placeholder artwork and rerun asset generation.
2. Register `com.benjaminaird.everplate` in Apple Developer and create the App Store Connect record.
3. Select the Apple development team and enable automatic or managed signing locally; never commit certificates/profiles.
4. Confirm camera/photo permission copy, privacy manifest, encryption declaration, account-deletion flow, privacy policy, and support URL.
5. Decide whether to add a real EverPlate universal-link domain. If so, host `apple-app-site-association`, add Associated Domains in Xcode, and add the domain to backend origin/redirect policy before changing links.
6. Complete privacy nutrition labels and age/category/content answers.
7. Archive with the internal command, validate in Xcode Organizer, then upload manually. Nothing in this repository uploads automatically.

## Google Play handoff checklist

1. Install Java 21 and Android SDK; set local SDK paths outside Git.
2. Replace all placeholder artwork and validate round, squircle, adaptive, and themed monochrome masks.
3. Reserve `com.benjaminaird.everplate` and create the Play Console app.
4. Create an upload key/Play App Signing configuration outside Git. The generated release build intentionally has no committed signing secrets.
5. Review camera and photo permissions against the current Play photo/video policy; remove broad permissions if device testing confirms the system picker is sufficient for every supported Android version.
6. Complete Data Safety, account deletion, privacy/support URLs, content rating, target audience, and store listing.
7. Build the AAB with the internal command and upload it manually. No upload task is configured.

## Validation and known limitations

- Native browser dialogs are replaced for destructive actions; native sharing includes generated PDFs through a temporary cache file.
- The app refreshes session and cloud data on resume. Local recipe mirrors remain readable when offline, with an explicit offline banner. Save/import operations still require the backend and retain existing failure behavior.
- Camera/photo/document selection uses the platform file chooser behind the existing tested inputs. Permission descriptions are prepared; physical-device verification remains required.
- External `_blank` HTTPS links open with the Capacitor Browser plugin. Internal application navigation stays inside the shell.
- Dark mode is selected from system appearance and reloads the shared UI when appearance changes. Reduced-motion CSS disables navigation animation.
- The production dependency audit is clean. Build-only asset tooling currently has transitive npm advisories; it is not packaged into the app. Review/uprev `@capacitor/assets` when its upstream tree is fixed.
- Android compilation was not possible on the preparation machine because Java is absent. iOS unsigned compilation and simulator/device visual QA are separate verification outputs recorded in the final task report.
- Real-device checks are still required for Dynamic Island/notches, Android edge-to-edge, keyboard, camera/photo/document picker, cookie persistence, share sheet, file export, deep links, rotation, VoiceOver/TalkBack, dynamic text, and network transitions.
- Dedicated EverPlate legal pages, universal links, social sign-in callbacks, push notification metadata, analytics, and store credentials are intentionally not configured.

## Rollback

The work is isolated to the feature branch. The safest rollback is to stop using or delete `codex/everplate-native-brand`; `main` remains at the verified RecipeBox state. If reverting after merge, use `git revert` on the EverPlate commits in reverse order. Do not reset, force-push, alter the Vercel project, or roll back the database—this work performs no migration.
