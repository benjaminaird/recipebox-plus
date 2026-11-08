---
status: accepted
date: 2026-11-08
---

# One semantic token set with System, Light and Dark appearances, from the first build

RecipeBox supports a light and a dark appearance from the initial native build.
They are **two appearances of the same design system** (ADR 0018), not two
identities. Retrofitting dark mode means auditing every hard-coded colour on
every screen. Building it in from the first component costs almost nothing.

The client is React Native + Expo (ADR 0002). The token system and theme
architecture are designed for that stack and work with each platform's own
appearance setting rather than imitating it.

## The user's setting

| Setting | Behaviour |
| --- | --- |
| **System** (default) | Follows the device's Light, Dark or Automatic setting and changes live, with no relaunch, including at sunset under Automatic. |
| **Light** | Always light, whatever the device says. |
| **Dark** | Always dark, whatever the device says. |

- The setting lives under the account menu (the avatar on Home) as
  **Appearance**. It is a three-option radio group with a small preview of each
  option.
- It is a **device preference**, stored in the local database's settings table
  (ADR 0004). It is not synced: a phone and a tablet can reasonably differ, and
  it must work before sign-in. It is read **before the first frame**, so the app
  never flashes the wrong appearance on launch.
- It is not part of the portable export (ADR 0009). It describes the device,
  not the library.

## Semantic tokens

- `design/tokens/recipebox.tokens.json` is the single source of truth. Every
  colour token has a `light` and a `dark` value and a written role: canvas,
  surfaces, text levels, separators, accent, status (attention, success,
  danger), focus, scrim, photo overlays and the typographic tile. The file also
  carries the type roles, spacing, radii, elevation, touch-target minimums,
  motion and the photography policy.
- **Components reference token names only.** A raw hex value in a component is
  a defect, caught in review and by a lint rule once the app exists.
- Dark is designed, not inverted:
  - Surfaces get lighter as they rise.
  - Shadows deepen but carry less of the work. A one-point top highlight
    defines edges.
  - Text is warm ivory on warm near-black. Never `#FFFFFF` on `#000000`.
  - The accent shifts from botanical green to a coordinated sage.
- **Contrast is enforced by a script, not by eye.**
  `scripts/design-tokens-check.js` verifies that every colour token has both
  values. It also checks that every declared foreground/background pair meets
  its minimum in both appearances: 4.5:1 for text and 3:1 for focus rings and
  control fills. It is read-only and runs today (`node
  scripts/design-tokens-check.js`). It becomes a CI gate when CI exists (M3).

## Architecture in React Native + Expo

- **Package.** When the monorepo exists (ADR 0003, M3), the token file moves to
  `packages/design-tokens`. A build step emits a typed module (`as const`)
  consumed by `apps/mobile`. Until then it stays in `design/tokens/`, outside
  anything the web app builds or serves.
- **Native appearance.** `app.json` sets `userInterfaceStyle: "automatic"`, so
  both platforms report the system appearance. `expo-system-ui` is installed so
  this takes effect on Android and the root view's background matches the
  appearance. `expo-splash-screen` gets light and dark variants.
- **Applying the setting.** On launch and on change, the app calls
  React Native's `Appearance.setColorScheme` with `'light'`, `'dark'` or the
  platform's follow-system value. The follow-system value is `null` or
  `'unspecified'` depending on the React Native version, and is pinned when the
  shell is created. This switches the native layer
  (`overrideUserInterfaceStyle` on iOS, night mode on Android). System alerts,
  action sheets, date pickers, the keyboard, context menus and in-app browser
  chrome then match the app instead of the phone.
- **Resolving tokens.** A `ThemeProvider` reads `useColorScheme()`, which reflects
  the override and live system changes. It exposes the resolved token set
  through `useTheme()`. Styles are built by memoised factories keyed by scheme,
  so switching appearance re-renders without remounting navigation or losing
  Cook Mode state.
- **System chrome.** `expo-status-bar` uses `style="auto"`. The React
  Navigation (or Expo Router) theme is generated from the same tokens, so
  headers, tab bars and transitions never fall back to library defaults.
  Translucent bars use `expo-blur` on iOS. Android uses the opaque `material`
  colour unless blur measures acceptably on mid-range devices.
- **Elevation.** Each elevation level maps to iOS shadow properties and
  Android `elevation` (or React Native's cross-platform `boxShadow` on the New
  Architecture). The dark top highlight is a hairline border, not a shadow.

## Typography and text scaling

- **Serif:** Newsreader, bundled with `expo-font`, used for titles and editorial
  roles. **Sans:** the system font, never bundled, so it keeps the platform's
  Dynamic Type and font-scale metrics.
- Every text role scales with the OS setting (`allowFontScaling` stays on), with
  no cap below 200%. The one exception is tab-bar labels, which do not scale,
  as on iOS. On iOS a long-press shows the enlarged label through the Large
  Content Viewer. React Native has no built-in support for it, so this needs a
  small native module or an accepted gap recorded in M4.
- Layouts switch to their large-text arrangement when
  `useWindowDimensions().fontScale` reaches **1.35**: single-column library, step
  portions under the step, wrapped fact rows, stacked Cook Mode controls. Text
  never truncates to fit, except the inline navigation title, which ellipsises
  as on iOS.

## Motion and touch

- Reduce Motion is read through `AccessibilityInfo` (and Reanimated's
  `useReducedMotion`). When it is on, pushes become cross-fades, sheets appear
  without the rise and Cook Mode steps do not slide.
- Minimum touch target: **44 × 44 pt on iOS, 48 × 48 dp on Android**. Small
  visuals such as flag pills use `hitSlop` to reach the minimum. They never
  shrink the target.

## Photography

Photos are never dimmed or tinted to suit an appearance (ADR 0018). The only
overlays are the tokens `photoOverlayTop` (behind status bar and floating
controls on a hero) and `photoControl` (the disc behind a control on a photo).
They are identical in both appearances, because the photo underneath is the
same.

## Consequences

- Every screen is reviewed in Light and Dark, at 100%, 150% and 200%, before it
  is called done (see the real-device protocol in
  [docs/design/accessibility-device-testing.md](../design/accessibility-device-testing.md)).
- Adding a colour means adding a token with both values and, if it carries text
  or marks a control, a contrast pair. The check script fails otherwise.
- The web app keeps its current styling (ADR 0005). It can adopt the token file
  later without new design work, because the tokens are platform-neutral data.
