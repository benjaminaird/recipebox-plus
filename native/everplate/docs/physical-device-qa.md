# EverPlate physical-device QA

Use this checklist for the first direct Xcode installation and after changes to native configuration, plugins, authentication, imports, or release assets.

## Session record

- Date:
- Tester:
- Commit:
- EverPlate version/build: `1.0.0 (1)`
- iPhone model:
- iOS version:
- Xcode version:
- Network(s) tested:
- Result: Pass / Fail
- Notes or issue links:

## Install and visual identity

- [ ] Run `npm run native:everplate:sync`; it completes without errors.
- [ ] Open `native/everplate/ios/App/App.xcodeproj`, select the `App` target, enable automatic signing, and select the correct Apple Developer team.
- [ ] Select the connected iPhone and run the `App` scheme successfully.
- [ ] The installed name is EverPlate and the Home Screen icon is sharp at real size.
- [ ] Cold launch shows the correct light or dark EverPlate splash without a white flash, crop defect, or RecipeBox artwork.
- [ ] The small navigation monogram stays legible and aligned.
- [ ] Search the visible app for accidental RecipeBox branding; shared backend or legal references are the only permitted exceptions.

## Layout, appearance, and accessibility

- [ ] Light mode is readable and matches the EverPlate palette.
- [ ] Dark mode is readable; switch appearance while the app is installed and relaunch if prompted by the current implementation.
- [ ] Content clears the Dynamic Island/notch, status bar, rounded corners, and Home indicator in portrait.
- [ ] Rotate to each supported landscape orientation; layout and controls remain usable.
- [ ] Open the keyboard in login, search, recipe editing, and import fields; the focused field and primary action remain reachable.
- [ ] Dismiss the keyboard and confirm the layout returns to its original position.
- [ ] Increase Settings > Accessibility > Display & Text Size > Larger Text; critical copy and actions remain understandable without destructive overlap.
- [ ] With VoiceOver enabled, verify useful labels and focus order for login, bottom navigation, search, save, favorite, edit, category, import, share, and close/back actions.
- [ ] Inspect the smallest metadata and instruction text at normal viewing distance; record any text that is not comfortably legible.

## Authentication and lifecycle

- [ ] Sign in with a valid account; the library loads from the production backend.
- [ ] Force-quit and reopen; the signed-in session and library persist.
- [ ] Background the app for at least one minute and resume; session and current work remain intact.
- [ ] Log out; authenticated data is no longer available.
- [ ] Force-quit and reopen after logout; the app remains signed out.
- [ ] Request password reset and email verification as applicable. Email links may open the RecipeBox web flow in Safari until Universal Links are configured; `everplate://` links launched on-device must route into the app.
- [ ] Open a known `everplate://` reset, verify, or import test link; the matching in-app flow appears and Safari does not open.
- [ ] Open an external support/legal link; it opens in the system browser and returns cleanly to EverPlate.

## Core recipe behavior

- [ ] Browse a library with enough recipes to scroll; thumbnails, long titles, and cards render correctly.
- [ ] Search by title and ingredient; clear the search and recover the full list.
- [ ] Create a recipe, save it, leave the screen, and reopen it; all fields persist.
- [ ] Edit the recipe, save, relaunch, and verify the edit persists.
- [ ] Simulate a failed save by disconnecting immediately before saving; the edit remains on screen and can be retried after reconnecting.
- [ ] Save the same recipe/request twice where retry is available; no duplicate is created.
- [ ] Add/remove a favorite and verify it persists after relaunch.
- [ ] Create and browse categories, use Move to Category, and confirm the recipe moves once without data loss.
- [ ] Move a recipe into Baked Goods; the category name, image, filtering, and persistence are correct.
- [ ] Scale a recipe up and down; quantities and original values remain coherent.
- [ ] Switch US and metric units; values and labels convert correctly and can be switched back.
- [ ] Enter Cook Mode on a long recipe; navigation, wake behavior, timers, and exit/back behavior work.
- [ ] Test a very long recipe with long ingredients, directions, notes, and source text; scrolling and editing remain responsive.

## Imports and AI

- [ ] Import a supported recipe URL and verify title, ingredients, directions, attribution, and image.
- [ ] Import pasted recipe text and verify field separation and editing.
- [ ] Choose one or more photos from the photo library; the system asks only for necessary access and import completes.
- [ ] Use the camera from the import picker; the camera explanation is clear and returning to EverPlate preserves the import flow.
- [ ] Import a PDF from the document picker; cancel once, then complete an import, confirming both paths are safe.
- [ ] Import a non-photo document supported by the picker where applicable.
- [ ] Run an AI adjustment and verify progress, error recovery, and the resulting changes.
- [ ] Save an AI-adjusted recipe as a new version; both the original and new version remain intact.

## PDF and sharing

- [ ] Create a PDF from a short recipe and a multi-page recipe; typography, page breaks, branding, ingredients, and directions are correct.
- [ ] Open the native share sheet for a PDF; preview and share/save destinations receive an intact file with a sensible filename.
- [ ] Cancel the share sheet; EverPlate remains responsive with no duplicate modal.

## Connectivity and recovery

- [ ] With the app open, disable Wi-Fi and cellular data; the offline indicator appears and saved local recipes remain browsable.
- [ ] Attempt a network-dependent action while offline; the error is clear and entered work is retained.
- [ ] Reconnect; online state returns and the action can be retried without relaunching.
- [ ] Move the app between foreground and background during an import or edit; no duplicate navigation or lost input occurs.
- [ ] Use native back/close controls where presented; each closes only the current layer and never unexpectedly exits on iOS.

## Completion

- [ ] Record every failure with steps, screenshots, expected result, actual result, device/iOS version, and commit.
- [ ] Re-run failed checks after fixes and record the new commit.
- [ ] Confirm no production deployment, database migration, TestFlight upload, or App Store Connect change was made during this device session.
