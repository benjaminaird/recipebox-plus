---
status: accepted
date: 2026-11-08
---

# RecipeBox's visual identity is the Modern Cookbook direction

Three deliberately distinct concepts were prototyped and reviewed on an iPhone
across Home, Recipes, Recipe Detail, Cook Mode and Import Review at 100%, 150%
and 200% text:

- **A — Card Catalogue**: manila, oxblood, condensed grotesk, ruled columns.
  **Rejected.** It is too close to the existing web RecipeBox, and the product
  owner does not want to repeat that aesthetic.
- **B — Dusk Kitchen**: umber, glazed surfaces, soft serif, layered depth.
  Admired for its sophistication and material depth.
- **C — Cookbook Page**: paper, forest green, text serif, marginalia.
  Preferred as the foundation.

The product owner chose a fourth, refined direction built from C and B, the
**Modern Cookbook**, as RecipeBox's primary visual identity for the native app
(ADR 0001). It is premium, contemporary, calm and warm without being rustic.
It is also built to feel like a native iPhone app rather than a themed website.

## What the identity is

- **Foundation from C:** a serif (Newsreader) for screen titles, recipe titles,
  section and preparation headings, and other editorial moments. Generous
  margins, italic section headings and hairline rules. Step marginalia lists the
  portion each step uses beside the instruction, at default text sizes (ADR 0012).
- **Depth from B:** layered surfaces. The recipe sheet rises over its hero photo,
  cards sit on soft shadows, photography has rounded corners in a two-column
  grid, and navigation and tab bars are translucent over content.
- **Interface text** uses the platform system font: SF Pro on iOS and Roboto on
  Android.
- **Palette:** warm contemporary off-white, soft neutrals, charcoal text and a
  restrained botanical green in Light. Warm near-black, ivory text and a sage
  green in Dark. Values and roles are in ADR 0019 and
  `design/tokens/recipebox.tokens.json`.
- **Explicitly not:** manila, aged paper, heavy cream, terracotta, wood,
  excessive brown, copper or orange, handwriting faces, paper texture or
  vintage recipe-card styling.

## Decisions made on review (2026-11-08)

1. **Cook Mode instructions use the system sans** at 25pt (scaling with the
   OS), to maximise legibility at arm's length. The serif stays for the recipe
   title, preparation headings and editorial elements. Cook Mode should feel
   sophisticated, but usability wins.
2. **The dark accent is sage green**: `#9FCDB0` for text and icons on a deeper
   green fill. It is the starting colour and must stay coordinated with the light
   botanical green and pass the contrast rules in ADR 0019. During token
   finalisation the dark fill moved from the prototype's `#336B50` to `#397457`
   so the fill itself clears 3:1 against dark surfaces (WCAG 1.4.11).
3. **Photographs are not dimmed in Dark.** They keep their natural colour and
   brightness. Overlays are applied only where text or controls must sit on a
   photo, which today means a top gradient behind the status bar and floating
   controls on a hero image. Glare and comfort are judged on physical devices
   (see the accessibility protocol), not assumed.
4. **A recipe without a photograph gets a typographic tile**: the title's
   initial and its Category on a quiet tinted ground. RecipeBox never shows
   stock imagery for a personal recipe, because a generic photo misrepresents
   what someone actually cooks.

## Consequences

- One design system with two appearances (ADR 0019). Typography, layout,
  spacing, hierarchy, component shapes, navigation, iconography and motion are
  identical in Light and Dark. Only colour token values differ.
- The specification in [docs/design/modern-cookbook-spec.md](../design/modern-cookbook-spec.md)
  is the reference for building screens. The prototype
  (`docs/design/modern-cookbook-prototype.html`) is a disposable design
  experiment, as `CLAUDE.md` requires. It illustrates the spec and is never the
  foundation of the app.
- Concepts A, B and C are **historical design exploration**. They are preserved
  for reference in the RecipeBox Concept Studio artifact and listed in
  [docs/design/README.md](../design/README.md). They are not to be revived
  without a superseding ADR.
- The production web app is **not** restyled by this decision. It stays
  unchanged in behaviour and appearance (ADR 0005, `CLAUDE.md`). Bringing the
  identity to the web is a separate, later decision.
- Newsreader is licensed under the SIL Open Font License and is bundled with
  the app. Its licence file ships with the app's acknowledgements.
- The representative photography in the prototype comes from Wikimedia Commons
  under CC0, CC BY and CC BY-SA licences. It is for design review only and must
  not ship in the app or its store listings.
