# First iPhone build: RecipeBox design-system test app

**Goal:** install the Expo shell (`apps/mobile`) on your iPhone as a standalone
app called **RecipeBox**. It shows the Modern Cookbook design system and the
working System/Light/Dark setting.

**It contains nothing else:** no sign-in, no database, no AI calls, no sync and
no network use. Nothing is submitted to the App Store.

## What is ready (built on `claude/sweet-wozniak-ye7v06`, now consolidated into `feature/recipebox-2.0`)

| Item | State |
| --- | --- |
| Display name | `RecipeBox` (verified in the generated `Info.plist`: `CFBundleDisplayName = RecipeBox`) |
| Provisional bundle identifier | `com.benjaminaird.recipebox.dev` (iOS), and the same Android package. The `.dev` suffix keeps it clearly provisional. See [Choosing the permanent identifier](#choosing-the-permanent-identifier). |
| Devices | iPhone only (`supportsTablet: false`, `TARGETED_DEVICE_FAMILY = 1`) until an iPad layout is designed |
| Appearance | `UIUserInterfaceStyle = Automatic`; light and dark splash backgrounds; System/Light/Dark setting saved on the device |
| Version | `0.1.0`. Build numbers are managed by EAS (`appVersionSource: remote`) |
| `eas.json` | Two profiles. **`device-test`** is a standalone internal build with JavaScript embedded, so it needs no computer once installed. **`development`** is a development client for later day-to-day work. Neither has a submit profile. |
| `expo-dev-client` | Installed (used only by the `development` profile) |
| Icons | Provisional monogram ("R" in Newsreader on botanical green) generated from the design tokens. Replace them before any store release. |
| Verified | `expo prebuild` generates a valid iOS project; type check and unit tests pass; iOS and Android bundles compile to Hermes bytecode; CI's native shell job runs all of this on every push |

## What needs you (nothing below can be done safely from the cloud)

| Requirement | Why it needs you |
| --- | --- |
| **Apple Developer Program membership** (US$99/year) | Installing a build on a physical iPhone outside the App Store needs ad hoc provisioning, which needs a paid membership. A free Apple ID won't work with EAS. If you already have one (the older release docs list it as a to-do, not a fact), skip this. |
| **Expo account** (free) | EAS builds run under your Expo account. `eas init` links this app to it and writes a `projectId` into `app.json`, which then gets committed. |
| **Apple sign-in during the first build** | EAS asks for your Apple ID and two-factor code once, then creates and stores the signing certificate and provisioning profile. That's an interactive login; I shouldn't hold your Apple credentials. |
| **Registering your iPhone** | Ad hoc builds only install on registered devices. Registration runs on the iPhone itself: you install a small configuration profile in Safari. |
| **Developer Mode on the iPhone** | iOS 16 and later require it for internally distributed apps. |
| **The permanent bundle identifier** | Your decision. It becomes fixed once an App Store Connect record exists. |

## Install steps

You need a computer with a terminal and Node 20 or newer, for about 15 minutes
of setup. It doesn't have to be your Mac. Everything after the build happens on
the iPhone.

```sh
# 1. Get the branch (on your Mac this is the same repo; elsewhere, clone it)
git clone https://github.com/benjaminaird/recipebox-plus.git && cd recipebox-plus   # or, in an existing clone: git fetch
git switch feature/recipebox-2.0
cd apps/mobile
npm ci

# 2. Sign in to Expo and link the project (creates it on expo.dev, adds projectId to app.json)
npx eas-cli@25.3.0 login
npx eas-cli@25.3.0 init

# 3. Register your iPhone. Choose "Website", then open the link or QR code on the iPhone in Safari
#    and install the profile: Settings → General → VPN & Device Management.
npx eas-cli@25.3.0 device:create

# 4. Build. Sign in with your Apple ID when asked and let EAS manage the certificate and profile.
#    Select your iPhone when it asks which devices to include.
npx eas-cli@25.3.0 build --profile device-test --platform ios
```

`eas.json` requires eas-cli 25.3.0 or newer. That version is pinned here
because it is more than two weeks old.

**On the iPhone:**

1. Turn on **Developer Mode**: Settings → Privacy & Security → Developer Mode,
   then restart. The toggle appears once a profile or a developer-signed app is
   present.
2. When the build finishes (typically 10–20 minutes), open the build page link
   that EAS prints, or scan its QR code, and tap **Install**.
3. Open **RecipeBox**. You should see the design-system check screen. Test:
   - Switch Appearance between System, Light and Dark. With System selected,
     change the phone's appearance in Control Centre and the app should follow
     immediately.
   - Force-quit and reopen. The setting should persist, with no flash of the
     wrong appearance.
   - Set Settings → Accessibility → Display & Text Size → Larger Text to the
     largest size. The layout should reflow with nothing cut off.
   - Turn on VoiceOver. The Appearance options should read as a radio group
     with the selected option.
4. After step 2, commit the `projectId` that `eas init` wrote into
   `apps/mobile/app.json`, on `feature/recipebox-2.0`.

Then record the results in the QA log, as
[accessibility-device-testing.md](./design/accessibility-device-testing.md)
describes.

**Never run `eas submit`.** No submit profile exists, and App Store submission
is out of scope.

### Could the cloud session do steps 2–4 instead?

Partly, but I don't recommend it for the first build. It would need an Expo
access token, which could be saved as an environment secret, and a way to sign
in to Apple. Apple's two-factor login is interactive, and the alternative is
handing an App Store Connect API private key (`.p8`) to a cloud environment.
Once the certificate and profile exist on EAS, later builds could be triggered
from a cloud session with only an Expo token. That would be a reasonable
follow-up.

## Choosing the permanent identifier

| Candidate | App Store | Google Play | Notes |
| --- | --- | --- | --- |
| `com.recipeboxapp.recipebox` | free | free | Already planned in `docs/native-release-readiness.md` and the historical `capacitor.config.json`. Best fit **if you own `recipeboxapp.com`**, or plan to. |
| `com.benjaminaird.recipebox` | free | free | Personal namespace. Safe if you don't own a RecipeBox domain. Harder to transfer to a company later. |
| `com.recipebox.app` | **taken** ("ReciBook: Clip, Save, Cook") | **taken** | Don't use. |
| `com.recipebox` | **taken** ("RecipesBook App") | free | Don't use. |

These checks used the public App Store lookup and Google Play listing
(2026-11-08). **They can't see identifiers that are registered in another
developer's Apple account but never published.** That collision only shows up
when EAS tries to register the identifier on the first build, which is one
reason to start with the provisional `.dev` ID.

**Name note for later:** on the US App Store, a developer named "RecipeBox, LLC"
publishes "RecipeBox - Save Your Recipes!", and "RecipeBox: My Recipe Book" also
exists. The on-device display name "RecipeBox" is fine for testing. The App
Store listing name, and any trademark question, should be settled before a
public release. That's a product and legal decision, not a technical one.

## Running on a simulator reliably

Use `npm run ios:sim` (from `apps/mobile`) rather than `npx expo run:ios`
directly. The script exists because three things went wrong repeatedly, and
each one wasted a build cycle:

**The locale.** `expo run:ios` runs `pod install` itself, and CocoaPods calls
`String#unicode_normalize` on the project path. Under a non-UTF-8 locale that
raises `Unicode Normalization not appropriate for ASCII-8BIT
(Encoding::CompatibilityError)` and the build dies before compiling anything.
Exporting `LANG` in one terminal does not fix it for the next invocation, so
the script sets `LANG`/`LC_ALL` itself. `npm run pods` does the same for a
direct `pod install`.

**Masked exit status.** `xcodebuild ... | tail` exits with *tail's* status. A
build that failed with error code 65 reports 0, and the failure is only
visible by reading the log. Never pipe a build command whose status you intend
to check. The script runs under `set -o pipefail` and reads `PIPESTATUS[0]`.

**"The simulator looks fine."** A screenshot is not evidence that RecipeBox
started. The simulator may be showing springboard, a different app, or
RecipeBox's own splash while the JS bundle fails to load — all three have
happened here. The script launches by bundle id, captures the pid, waits, and
re-checks the pid, so an app that starts and immediately dies is caught.

It still cannot prove the bundle loaded or that the right screen is up; it
says so when it finishes, and writes a screenshot to look at. For a dev build,
the Expo launcher satisfies every automated check while showing no RecipeBox
UI at all.

### `expo prebuild` rewrites package.json

`expo prebuild` has twice rewritten `"ios": "expo start --ios"` to
`"expo run:ios"`, baking in a bare-workflow assumption against this project's
deliberate CNG setup (`ios/` and `android/` are gitignored and regenerated).
Check `git diff package.json` after any prebuild and revert that line.
