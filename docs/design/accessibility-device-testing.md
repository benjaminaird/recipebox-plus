# Real-device accessibility testing protocol

Applies to every screen of the native app before it is called done, and to the
release candidate as a whole. Simulators and the web prototype are useful for
iteration. **They are not evidence.** A screen passes only when this protocol has
been run on physical hardware and the results are recorded.

Related: [ADR 0019](../adr/0019-semantic-tokens-and-appearance.md),
[design spec §6](./modern-cookbook-spec.md#6-accessibility-requirements),
[`docs/native-readiness-checklist.md`](../native-readiness-checklist.md).

## Devices

- **iPhone, current iOS:** one compact model (an SE-class 4.7" or a 6.1" base
  model) and one large model (Pro Max class).
- **Android:**
  - one mid-range device on a current Android release (Pixel 7a class), with
    TalkBack on the Android Accessibility Suite;
  - one Samsung device with One UI, because its font scaling and dark mode
    differ from Pixel.
- **Optional:** an iPad, for split view and text scaling in a wide layout.

## Matrix per screen

Run Home, Recipes, Recipe Detail, Cook Mode and Import Review, plus Settings →
Appearance, under each combination:

| Appearance | Text size |
| --- | --- |
| Light / Dark (each via **System** and via the in-app override) | Default; iOS Larger Text AX1 and AX5 (largest); Android font scale 1.5 and 2.0 (plus Display size Large) |

## Checks

### Appearance

- [ ] With System selected, switching the phone between Light and Dark updates
      the open screen live, including on an open sheet and in Cook Mode with a
      running timer. No state is lost and there is no flash.
- [ ] The Light and Dark overrides stay put when the phone changes appearance.
- [ ] The setting survives a force-quit and a relaunch. The first frame shows
      the correct appearance, and the splash screen matches it.
- [ ] System UI follows the app's appearance: alerts, action sheets, keyboard,
      date pickers, share sheet and the in-app browser.
- [ ] Dark mode at **minimum brightness in a dark room**: no surface glares and
      no pure white is visible. Photos are comfortable or are logged as a
      specific image class to review. Photos are not dimmed globally (ADR 0018).
- [ ] Light mode **outdoors or under bright kitchen light** at full brightness:
      secondary and tertiary text stay readable.

### Text scaling

- [ ] No truncation, clipping or horizontal scrolling at any size. Long recipe
      titles wrap.
- [ ] The large-text layouts engage at 1.35× (single-column library, chips under
      steps, stacked Cook Mode controls).
- [ ] Tab labels stay at standard size. The Large Content Viewer works on
      long-press (iOS), or its absence is logged as a known gap.
- [ ] At the largest size, Cook Mode step text is readable from **60 cm and
      1 m**. Tester notes are recorded.

### VoiceOver (iOS) and TalkBack (Android)

- [ ] Swiping through each screen reads in visual order. Every control has a
      name, role and state (selected, checked, disabled, expanded).
- [ ] Headings navigation (rotor or TalkBack headings) lands on the screen title
      and on each section: Ingredients, Method, Source and the preparation
      headings.
- [ ] Ingredient rows read "quantity, name" as one element. Flags read
      "needs checking" with the reason.
- [ ] A Recipes card reads the title, time, servings, "favourite" and "needs
      checking", and the image is not announced separately.
- [ ] Typographic tiles are silent.
- [ ] The Appearance setting is announced as a radio group with the selected
      option.
- [ ] Sheets trap focus. Closing returns focus to the control that opened them.
      The VoiceOver escape gesture (two-finger Z) and the Android back gesture
      close them.
- [ ] Cook Mode:
  - [ ] Step changes are announced.
  - [ ] Next and Back can be reached without hunting.
  - [ ] Timer start, pause and finish are announced. A finished timer
        notification is spoken when the app is in the background.
- [ ] Source: "View Original Recipe, opens *domain* in your browser". When
      offline, the explanation is read.
- [ ] Import Review: each flag's action is reachable. "Save with *n* flags" says
      what it will do.

### Reduced motion

- [ ] With Reduce Motion (iOS) or Remove animations (Android) on: no sliding
      screens, sheets or Cook Mode steps, and nothing moves position. Haptics
      remain.

### Touch targets

- [ ] Inspect with Xcode Accessibility Inspector (iOS) and Accessibility Scanner
      (Android). Every target is at least 44 × 44 pt or 48 × 48 dp. Hit-slop
      targets are verified by tapping their edges.
- [ ] Wet-hands and one-handed use in Cook Mode: Next is reachable with the
      thumb on the large device.

### Contrast

- [ ] `node scripts/design-tokens-check.js` passes. It covers every token pair.
- [ ] Spot-check rendered screens with Accessibility Inspector or Accessibility
      Scanner for any colour that bypassed tokens.

## Recording results

For each run, record in the release's QA log:

- device, OS version, build number, appearance and text size;
- pass or fail per check, with a screenshot or screen recording for any
  failure;
- the tester's name and date.

A failure blocks the screen until it is fixed or explicitly accepted, with a
reason, by the product owner.
