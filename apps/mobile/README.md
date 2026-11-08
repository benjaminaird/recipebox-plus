# RecipeBox native app (Expo shell)

**Status: development foundation only.** This is the start of the native
RecipeBox client (ADR 0001, ADR 0002). Today it renders one *design system
check* screen, which shows:

- the Modern Cookbook type roles and colour tokens (ADR 0018, ADR 0019);
- the typographic tile used for recipes without a photo;
- a Cook Mode instruction in the system sans;
- a working **Appearance** setting: System (default), Light or Dark.

It deliberately has **no** recipe engine, accounts, network calls, sync or
production data. It shares nothing at runtime with the web app, and nothing in
the web app's build or deploy depends on this folder.

| | |
| --- | --- |
| Expo SDK | 58 (React Native 0.88, React 19.3, New Architecture, Hermes) |
| Serif | Newsreader 300, 400, 400 italic and 500 via `@expo-google-fonts/newsreader` (SIL OFL) |
| Sans | Platform system font, never bundled |
| Tokens | Generated from `../../design/tokens/recipebox.tokens.json` into `src/theme/tokens.generated.ts` |
| Appearance preference | Device-local, in SQLite via `expo-sqlite/kv-store`, read synchronously before the first frame |

## Commands

```sh
npm ci
npm run tokens          # regenerate tokens after editing design/tokens/recipebox.tokens.json
npm run tokens:check    # CI: fails if the generated file is stale
npm run typecheck
npm test                # pure appearance rules and token invariants (node:test)
npm run export:check    # bundles iOS and Android to Hermes bytecode; no device needed
npx expo start          # run on a device (development build recommended)
```

## How appearance works

- `app.json` sets `userInterfaceStyle: "automatic"`. `expo-system-ui` and
  `expo-splash-screen` have light and dark backgrounds, so there is no white
  flash in Dark.
- At launch, before the first frame:
  1. `preferenceStore` reads `settings.appearance` from SQLite.
  2. `Appearance.setColorScheme` receives `'light'`, `'dark'` or `'auto'`.
     `'auto'` is React Native 0.88's follow-the-system value, which pins the
     open point in ADR 0019.
- `ThemeProvider` resolves the token set from `useColorScheme()`, so when System
  is selected an OS change applies live.
- Components read colours, type, spacing and radii only through `useTheme()`.

## Not yet verified

- **Physical devices:** nothing has been run on an iPhone or Android device
  yet. The real-device protocol in
  `docs/design/accessibility-device-testing.md` applies from the first build.
- **Icons:** the app icons and splash image are a provisional monogram, not
  final artwork.
- **Bundle identifier:** provisional, `com.benjaminaird.recipebox.dev`. The
  permanent identifier is not chosen yet.
- **iPhone install:** see `docs/ios-device-build.md`. Use the `device-test`
  EAS profile (standalone) or `development` (dev client). There is no submit
  profile.
