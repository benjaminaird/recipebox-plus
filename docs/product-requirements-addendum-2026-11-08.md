# Product requirements addendum: 8 November 2026

**What this is.** These are the approved sections to fold into
`docs/product-requirements.md`. That file was renamed from
`docs/recipebox-2.0-requirements.md` in a local commit on
`feature/recipebox-2.0` that **has not been pushed to GitHub yet**. Neither have
ADRs 0008–0017 or the recipe-model investigation plan. This addendum is a
separate file so it merges cleanly once those commits are pushed. After merging,
paste each section into `product-requirements.md` as labelled and delete this
file. See [Merge steps](#merge-steps).

---

## Visual identity: confirmed

*Replaces the "Visual direction" item under **Unresolved**.*

RecipeBox's identity is the **Modern Cookbook** direction:

- **From Concept C:** editorial typography, spaciousness and composition.
- **From Concept B:** material depth and polish.
- **Not from Concept A:** none of its vintage, catalogue-like palette or
  styling.

It is premium, contemporary, warm without being rustic, tactile through subtle
depth, calm, and native to the platform. Recorded in
[ADR 0018](./adr/0018-modern-cookbook-visual-identity.md), specified in
[docs/design/modern-cookbook-spec.md](./design/modern-cookbook-spec.md).

- Serif (Newsreader) for screen, recipe, section and preparation titles. System
  sans for interface text and **Cook Mode instructions**.
- Photographs keep their natural colour and brightness in both appearances.
  Overlays are used only where controls sit on a photo.
- A recipe without a photograph shows a typographic tile, never stock imagery.
- Concepts A, B and C are preserved as historical exploration.

## Appearance: confirmed

Light and Dark appearances ship in the **initial native build**, as two
appearances of one design system with shared semantic tokens
([ADR 0019](./adr/0019-semantic-tokens-and-appearance.md)).

- **Setting:** System (default), Light or Dark, under the account menu.
- **Persistence:** saved on the device and applied before the first frame.
- **Live updates:** with System selected, the app follows OS changes without a
  relaunch.
- **Dark palette:** warm near-black and ivory with a sage-green accent. No pure
  black on pure white.
- **Contrast:** AA in both appearances, enforced by
  `scripts/design-tokens-check.js`.

## Source attribution: confirmed

RecipeBox preserves and clearly shows where every imported Recipe came from
([ADR 0020](./adr/0020-recipe-source-attribution.md)).

- **Website imports** automatically save the cleaned original URL, the site
  name, the original recipe title and the credited author, when the page states
  them.
- **Video and social imports** save the post or video URL, the platform, the
  creator and the post or video title, where appropriate.
- **Photo, PDF, pasted-text and manual recipes** can have a source added or
  corrected by hand: type, name, optional link, original title, and author or
  creator (for example a cookbook page or "Grandma Ruth's card"). Adding a
  source is never required.
- **Recipe Detail:**
  - a "From / Adapted from *Site*" byline;
  - a compact **Source** section after the method, with **View Original
    Recipe**, which opens the original site in the in-app browser;
  - no oversized source card;
  - nothing about the source in Cook Mode.
- **Offline:** source details are always available. Opening the link needs a
  connection, and the app says so instead of failing silently.
- **Adapted recipes:** AI or manual adaptation keeps the original attribution
  and shows clearly that this version is **adapted** from the source, with the
  number of changes and a link to the history.
- **Durability:** source metadata survives editing, version history and revert,
  synchronisation and conflicts, household sharing, and portable backup and
  export.

## Accessibility testing on real devices: confirmed

*Extends **Accessibility — confirmed, foundational**.*

Every screen is verified on physical iPhone and Android hardware before it is
called done, following
[docs/design/accessibility-device-testing.md](./design/accessibility-device-testing.md):

- VoiceOver and TalkBack;
- text scaling up to the largest sizes;
- Reduce Motion;
- touch-target inspection (44 pt on iOS, 48 dp on Android);
- contrast;
- Light and Dark in both System and override modes, including low-light and
  bright-light comfort.

---

## Merge steps

1. Push the unpushed `feature/recipebox-2.0` commits from the Mac (the ADRs
   0008–0017 work, ending at `6de2255 docs: rename to RecipeBox and record the
   November requirements`).
2. Merge `claude/sweet-wozniak-ye7v06` into `feature/recipebox-2.0`. Every file
   it adds is new, so no conflict is expected. It does not touch `CLAUDE.md`,
   `GLOSSARY.md` or the existing ADRs.
3. Fold the four sections above into `docs/product-requirements.md` and remove
   "Visual direction" from **Unresolved**. Then delete this file.
4. In `CLAUDE.md` → *Decisions already made*, add:
   - `0018` — Modern Cookbook visual identity; earlier concepts are history
   - `0019` — one semantic token set; System / Light / Dark from the first build
   - `0020` — structured, durable Source attribution
5. In `GLOSSARY.md`:
   - extend **Source** with: "Structured: site, original URL, original title,
     author, how it arrived. Survives every edit, sync, share and export."
   - add **Adapted**: "A Recipe whose current version differs from its imported
     original. It is still attributed to its Source." Avoid: Modified, Remixed.
   - add **Appearance**: "The Light, Dark or System setting." Avoid: Theme,
     which is ambiguous with visual identity.
6. In ADR 0012's *What the model must add*, add a pointer: "**Source and
   derivation** — see ADR 0020." In ADR 0009's export contents, add "derivation
   (adapted or original)". Each is a one-line cross-reference. The decisions
   themselves live in ADR 0020.
