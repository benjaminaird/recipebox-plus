# Modern Cookbook visual direction — in review

Status: **Proposed, awaiting review.** Not an ADR yet. No native implementation has started.

- Prototype: `docs/design/modern-cookbook-prototype.html` (self-contained; open in a browser).
  Published for review at https://claude.ai/artifact/S7KhcRsrVhFm3S6cfMCf3h
- Earlier concepts A (Card Catalogue), B (Dusk Kitchen) and C (Cookbook Page) are preserved unchanged in
  RecipeBox Concept Studio: https://claude.ai/artifact/LKYGUtfew1gAxt7qMuWd4R

## Direction

Concept C's typography, spacing and editorial composition (Newsreader titles and Cook Mode steps, italic
section names, hairline rules, step marginalia), with Concept B's material depth (layered surfaces, soft
shadows, rounded photography, translucent bars). The interface font is the platform system font.
Concept A's palette and styling are not used.

## Appearance

One design system with two appearances: Light (warm off-white, charcoal text, botanical green) and Dark
(warm near-black, ivory text, sage-green accent). Both share every semantic token name. Only the values
change. User setting: System (default), Light or Dark. The setting is persisted, and System follows live OS changes.

## Open decisions before the ADR

1. Serif (Newsreader) or SF Pro for Cook Mode step text.
2. Dark accent pairing (sage text `#9FCDB0` on a deeper green fill `#336B50`).
3. Photo dimming in Dark (currently about 12%).
4. Typographic tiles for recipes without photos.

Photography in the prototype is from Wikimedia Commons (CC0, CC BY and CC BY-SA). Credits are listed in the prototype.
It is representative only and is not for shipping.
