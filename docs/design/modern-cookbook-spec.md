# Modern Cookbook design specification

Status: **approved 2026-11-08**. Decisions: [ADR 0018](../adr/0018-modern-cookbook-visual-identity.md) (identity),
[ADR 0019](../adr/0019-semantic-tokens-and-appearance.md) (tokens and appearance),
[ADR 0020](../adr/0020-recipe-source-attribution.md) (source attribution).
Values: [`design/tokens/recipebox.tokens.json`](../../design/tokens/recipebox.tokens.json).
Illustration: [`modern-cookbook-prototype.html`](./modern-cookbook-prototype.html). The prototype is disposable. When it and
this document disagree, this document wins.

Everything here applies identically in Light and Dark. Only colour token values change.

## 1. Foundations

### Type roles

| Role | Face | Size / line (pt at 100%) | Used for |
| --- | --- | --- | --- |
| largeTitle | Newsreader 400 | 34 / 37 | Screen titles |
| recipeTitle | Newsreader 400 | 28 / 31 | Recipe Detail title |
| sectionTitle | Newsreader italic 400 | 22 / 26 | Ingredients, Method, Source, Home sections |
| preparationTitle | Newsreader italic 400 | 20 / 24 | Preparation (component) headings |
| cardTitle | Newsreader 400 | 17 / 21 | Recipe titles on cards and rows |
| headline | System 600 | 17 / 22 | Buttons, emphasised rows |
| body | System 400 | 17 / 26 | Method on Recipe Detail, ingredient names |
| **cookStep** | **System 400** | **25 / 35** | **Cook Mode instruction (approved: sans for legibility)** |
| quantity | System 600, tabular | 17 / 22 | Quantities, servings |
| timer | System 300, tabular | 34 / 38 | Running timer |
| subhead / footnote | System 400 | 15 / 20, 13 / 18 | Secondary text, metadata |
| eyebrow | System 600, uppercase, +0.9 tracking | 12 / 16 | Labels above titles |
| tabLabel | System 500 | 10.5 / 13, **does not scale** | Tab bar |

The serif is for naming things: screens, recipes, preparations, sections. The system sans is for
doing things: instructions, quantities, controls, metadata.

### Space, shape, depth

- **Space:** spacing steps of 4 and 8 pt. The screen gutter is 20 and the gap
  between sections is 30.
- **Radii:** 10 for controls, 14 for groups and photos, 20 for cards, 26 for
  sheets, and pill. Use continuous corners.
- **Elevation levels:**
  - 0: rows.
  - 1: chips and secondary buttons.
  - 2: cards, photos and the docked primary button.
  - 3: sheets, and the recipe sheet over its hero.
- **Elevation in Dark:** a lighter surface plus a hairline top highlight.

### Colour roles

See the token file for values and contrast proofs. The semantic names are:

- grounds: canvas, surface, surfaceRaised, sunken, material;
- text: text, textSecondary, textTertiary;
- lines: separator, separatorStrong;
- accent: accent, onAccent, accentText, accentSoft;
- status: attention, success and danger, each with a soft variant;
- other: focusRing, scrim, tileGround/tileInk, onPhoto, photoControl,
  photoOverlayTop.

**Status is never colour alone.** Every flag has an icon and a word, for
example "⚠ Check", "✓ Set by you" or "Buy or make?".

### Photography

- **No dimming in either appearance.**
- **Top gradient:** `photoOverlayTop` (black 42% to transparent over 120 pt) sits
  only behind the status bar and floating controls on a hero.
- **Controls on a photo:** each sits on a `photoControl` blurred disc.
- **No text on photos:** text is never set directly on a photograph.
- **Missing photo:** use the **typographic tile**:
  - the title's first letter in Newsreader Light, about 44 pt in a grid tile;
  - the Category in eyebrow style;
  - `tileInk` on `tileGround`;
  - decorative (hidden from screen readers), because the title is already read.
- **Physical-device check:** glare and comfort in Dark are assessed on
  physical devices at low brightness (see the protocol). If a specific image
  class proves uncomfortable, the fix is a targeted treatment for that class,
  never a global dim.

## 2. Navigation and chrome

- **Tab bar:** Home · Recipes · Add (centred accent disc) · Plan · Lists. It is
  translucent `material` with blur, the active tab is `accentText`, and labels
  don't scale.
- **Navigation bar:**
  - Large serif title in content.
  - Once content scrolls 36 pt, the bar gains `material` and an inline system
    title.
  - Back is a chevron plus the previous title.
- **Sheets:**
  - A grabber, the `surfaceRaised` background in Dark and the `scrim` behind.
  - Dismiss by swiping down, tapping the scrim or Escape (hardware keyboard).
  - Focus moves into the sheet and returns to the invoking control on close.

## 3. Screens

### Home

1. Eyebrow date, then the large title greeting. The avatar opens Account and
   Appearance.
2. **Continue cooking** card (elevation 2):
   - photo, title, preparation name and step, and a progress bar;
   - running timer pill, and a Resume button.
3. **Ready to review** row for pending imports, with an attention pill ("2 to
   check").
4. **Tonight:** 16:10 feature photo with the title below it.
5. **Recently saved:** horizontal 4:5 cards.
6. **Favourites:** grouped inset list.
7. Edit Home.

The personalisation mechanism is still open (product requirements).

### Recipes

- Large title, then a search well (`sunken`), then category chips (44 pt tall)
  with counts. The selected chip is inverted text on canvas.
- Count and sort row.
- **Two-column grid** of square photos or tiles, each with the title in
  cardTitle and metadata.
- **At 1.35× text and above:** single-column rows with 72 pt thumbnails.
- Favourite and needs-review badges sit on the photo as discs or pills, and are
  also announced in the row's accessibility label.

### Recipe Detail

1. Hero photo at full bleed under the status bar, with floating back,
   favourite and more controls.
2. The recipe sheet rises 28 pt over the hero (radius 26, elevation 3).
3. Eyebrow Category, then the title.
4. **Byline with source:** "From / Adapted from *Site*", tappable (ADR 0020).
5. Fact row: Prep · Cook · Total · Makes. This becomes two rows at large text.
6. Attention notice if flags are open, with a Review action.
7. **Ingredients** with a servings stepper:
   - grouped by preparation, with italic serif preparation headings;
   - quantity column in tabular sans, then the name;
   - inline flags.
8. **Method:**
   - each step shows an accent-coloured "STEP n · timer" label and the body text;
   - tools are listed in footnote style;
   - **marginalia** to the right lists the portion of each ingredient that step
     uses (ADR 0012). At large text the portions move under the step as chips.
9. Your note, on an italic serif card.
10. **Source section** (§4).
11. Docked **Start cooking** button above the tab bar.

### Cook Mode

- **No tab bar.**
- **Top row:** a close button, the recipe title (serif, small) with "Step n of
  N", and an Ingredients sheet button. At large text, the title and count move
  to their own line.
- **Progress:** segmented bar.
- **Step:** the preparation name as an eyebrow, then the instruction in
  **cookStep** (system sans 25 pt).
- **For this step:** a grouped list of portions.
- **Timer:** a card with the 34 pt light clock and Pause/Resume. Multiple timers
  stack, and they fire as local notifications when the app is in the background.
- **Bottom bar:** Back (secondary) and Next step (primary), each 56 pt tall. At
  large text they stack, with Next on top.
- The screen stays awake. Swipe moves between steps. There is haptic feedback on
  step change. Reduce Motion removes the slide.
- **No source attribution** in Cook Mode.

### Import Review (ADR 0014)

- Large title with the recipe's name.
- **Source row:** what was captured, how and when, with Add/Edit.
- **Summary notice:** "*n* things to check. Nothing was guessed."
- Note when fields are left blank on purpose.
- "What the source says" disclosure.
- Ingredients and Method rendered **exactly as Recipe Detail renders them**,
  with flags in place.
- **Source section** with "Add source" when nothing was captured.
- Primary **Save with *n* flags**, and secondary **Check the first one now**.

## 4. Source section (ADR 0020)

- **Placement:** after Method and notes, never above the ingredients. The byline
  link is the way to reach it early.
- **Weight:** a `surface` group card at elevation 0 with a hairline lift, the
  same weight as the notes card. It holds:
  - a header row: 40 pt monogram tile, the name in headline, and domain · author
    in footnote;
  - a definition list: Original title · Added (method and date) · This version
    ("Same as the original" or "Adapted · *n* changes from the original", plus
    "See changes");
  - **View Original Recipe**: a secondary button with an external-link glyph,
    shown only when there is a URL. Its accessibility label is "View Original
    Recipe, opens *domain* in your browser".
- **Offline:** the button stays visible. Below it a status line reads "You're
  offline. The source details are saved on this phone; opening the original page
  needs a connection." Tapping it explains the same in a sheet. It never fails
  silently.
- **Edit sheet:**
  - fields: Type, Name, Link (optional, `http`/`https` only, validated), Original
    title, and Author or creator (optional);
  - saving writes a new version (cause: *source edited*).
- **Empty state:** "No source recorded…" with an **Add source** button.

## 5. Text-size behaviour

| Text size | Behaviour |
| --- | --- |
| 100% | Two-column grid, marginalia beside steps, four facts in one row. |
| ≥ 135% | Single-column library. Marginalia becomes chips under the step. Facts wrap 2 × 2. Ingredient name drops under the quantity. Cook Mode header wraps and its controls stack. |
| 200% | The same rules. Verified with no horizontal overflow on all five screens in both appearances in the prototype (2026-11-08). |

Text never truncates, except the inline navigation title.

## 6. Accessibility requirements

These are binding. The device protocol is in
[`accessibility-device-testing.md`](./accessibility-device-testing.md).

- **Contrast:** WCAG 2.2 AA in both appearances, proven by
  `scripts/design-tokens-check.js`.
- **Text scaling:** full OS scaling to 200% on every screen (§5).
- **Touch targets:** at least 44 × 44 pt on iOS and 48 × 48 dp on Android, with
  hit-slop for small visuals.
- **Screen readers:** VoiceOver and TalkBack.
  - Every control is labelled, and icon buttons have names.
  - Headings are marked, and the Appearance setting is a radio group.
  - Ingredient rows read as quantity then name.
  - Flags read as "needs checking: *reason*".
  - Timer completion is announced.
  - Decorative tiles and photos without meaning are hidden from the screen
    reader.
- **Reduced motion** is respected everywhere (ADR 0019).
- **Cook Mode readability:** sans 25 pt at 100%, at least 1.4 line height, and
  the step's own portions directly underneath.
