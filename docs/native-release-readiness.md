# Hearthkeep Native Release Readiness

Date: June 17, 2026

## Current Native Readiness Status

Hearthkeep is still deployed as a Vercel web app. The codebase now includes
Capacitor configuration and native-aware API/session infrastructure so the app
can later be wrapped for iOS and Android without rewriting core behavior.

## iOS Checklist

- Apple Developer account active.
- App Store Connect app created.
- Bundle ID: `com.recipeboxapp.recipebox`.
- App icon and splash assets generated at required sizes.
- Privacy policy URL: `/privacy.html`.
- Support URL: `/support.html`.
- Account deletion URL: `/delete-account.html`.
- Apple Sign In added before App Store release if other social logins exist.
- In-app purchase rules reviewed before selling Hearthkeep Plus in iOS.
- Safe areas tested on:
  - Dynamic Island iPhones
  - older notch iPhones
  - small iPhones
  - iPad if tablet support is enabled
- Timer alerts reviewed for native notification behavior.

## Google Play Checklist

- Google Play Developer account active.
- Package ID: `com.recipeboxapp.recipebox`.
- Android App Bundle generated and signed.
- Feature graphic created.
- Phone screenshots captured.
- Tablet screenshots captured if tablet support is enabled.
- Data Safety form completed.
- Account deletion URL provided.
- Google Play Billing reviewed before selling Hearthkeep Plus on Android.

## Privacy / Data Safety Checklist

Hearthkeep may collect or process:

- email address
- display name
- recipes
- meal plans
- pasted recipe text
- uploaded PDFs/images/screenshots
- AI prompts related to recipes
- AI usage counts
- account sessions and password reset tokens

Hearthkeep should disclose:

- data is used for app functionality and sync
- recipe content may be sent to AI providers for requested AI features
- data is not sold
- account deletion is available from Settings

## Permissions

Current or expected permissions:

- Internet: required for sync and AI features.
- Photo/file picker: required for recipe images, screenshots, and PDFs.
- Camera: only add if direct capture is implemented.
- Notifications: only add if native timer alerts are implemented.
- Microphone/location/contacts: not needed.

## Native UX Checklist

- No horizontal scrolling on phone.
- Bottom navigation respects safe area.
- Splash screen feels intentional.
- Core app functions avoid opening browser tabs.
- Settings, App Control, import, meal plan, cook mode, and recipe detail fit
  small screens.
- App Control modals scroll vertically and do not overflow sideways.
- Legal/support/account deletion links are available from Settings.
- Saved recipes should eventually support offline read access.

## Known Gaps

- Native `ios/` and `android/` projects have not been generated yet.
- Native subscriptions are not implemented.
- Native local notifications are not implemented.
- Native share-sheet import is not implemented.
- Offline cached recipe access is not implemented.
- App Store / Google Play screenshots and listings are not finalized.
