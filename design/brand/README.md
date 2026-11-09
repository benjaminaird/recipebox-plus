# RecipeBox brand assets

The RecipeBox symbol is a cookbook seen front-on — a spine panel, a front cover
and a two-leaf sprout — in the Modern Cookbook palette (ADR 0018, ADR 0019).

Everything in this directory and every brand PNG under `apps/mobile/assets/` is
generated from one file, [`geometry.mjs`](./geometry.mjs). Nothing is hand-drawn
or hand-exported, so the variants cannot drift apart.

## Provenance

The direction came from a logo concept board supplied by the product owner on
2026-11-08: a green cookbook with a leaf motif and an editorial serif wordmark.

**The artwork here is a reinterpretation of that board, not a reproduction of
it.** Nothing was traced, cropped or sampled from the concept image. The
geometry was rebuilt from primitives — rounded rectangles and leaves formed from
paired quadratic arcs — and deliberately differs from the board in three ways:

- **The book is upright and front-on**, not tilted with fanned pages. The fan
  was the first thing to disappear below about 60 px.
- **The binding is a separate panel** divided from the cover by a gap of
  background, rather than a rule drawn on the cover face. In the silhouette it
  reads as a book at large sizes and collapses into one clean card at small
  ones, instead of leaving a stray stroke on the face.
- **Colours are the product tokens**, not the board's. They are read from
  `design/tokens/recipebox.tokens.json` at build time, so the brand cannot drift
  from the palette the app actually ships.

The wordmark is set in **Newsreader**, the project's existing serif, under the
SIL Open Font License 1.1. It is already bundled in the app through
`@expo-google-fonts/newsreader`. No font file is copied into this directory and
no font was taken from the concept image.

## Regenerating

```sh
cd apps/mobile
npm install --no-save sharp
node ../../design/brand/build.mjs
```

`sharp` is intentionally **not** a dependency of `apps/mobile`: it ships large
prebuilt binaries, it is only needed when the artwork changes, and leaving it
out keeps `npm ci` and the CI mobile job unchanged. Install it on demand.

To change the mark, edit the constants at the top of `geometry.mjs` — `SPINE`,
`COVER`, `STEM`, `LEAF` — and re-run the build. Every asset below is rewritten.

## What gets written

### Vector masters (this directory)

| File | Use |
| --- | --- |
| `symbol-light.svg` | Symbol for light surfaces: green cover, ivory marks |
| `symbol-dark.svg` | Symbol for dark surfaces: sage cover, near-black marks |
| `symbol-mono.svg` | One colour, marks knocked out with `fill-rule="evenodd"` |
| `app-icon.svg` | Full icon composition: green field, ivory cover, green marks |
| `lockup-light.svg` | Horizontal symbol + wordmark for light surfaces |
| `lockup-dark.svg` | Horizontal symbol + wordmark on a near-black panel |

The lockup SVGs keep the wordmark as live `<text>` in Newsreader rather than
outlined paths. Outlining would mean committing a second copy of the font's
glyph data, and the app renders the wordmark with the real font anyway.
Renderers without Newsreader fall back to Georgia, then a generic serif.

### App assets (`apps/mobile/assets/`)

| File | Size | Use |
| --- | --- | --- |
| `icon.png` | 1024 | iOS and Android app icon. Opaque, no baked rounded corners |
| `android-icon-foreground.png` | 1024 | Adaptive foreground, inside the 66/108 safe zone |
| `android-icon-background.png` | 1024 | Adaptive background, flat `accent` |
| `android-icon-monochrome.png` | 1024 | Adaptive monochrome layer; the system tints it |
| `splash-icon.png` | 512 | Splash symbol, light appearance |
| `splash-icon-dark.png` | 512 | Splash symbol, dark appearance |
| `brand-symbol-light.png` | 256 | In-app header mark, light |
| `brand-symbol-dark.png` | 256 | In-app header mark, dark |
| `favicon.png` | 64 | Expo web |

The PNGs are square with the mark fitted inside, so rendering one at N×N with
`resizeMode="contain"` yields a mark exactly N tall.

## Checking the artwork

[`contact-sheet.html`](./contact-sheet.html) shows the icon at 180, 120, 60, 40
and 24 px under an iOS-style mask, the Android adaptive layers under circle,
squircle and rounded-square masks, the lockups on light and dark surfaces, the
splash symbol on both canvases, and the palette.

It loads Newsreader from `apps/mobile/node_modules`, so run `npm ci` in
`apps/mobile` first. Relative paths mean it needs to be served, not opened from
`file://`:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

then open `http://127.0.0.1:8765/design/brand/contact-sheet.html`.

## Known limits

- **At 24 px** the sprout is no longer separable into two leaves; the icon reads
  as a green tile with a light mark. That is expected at notification size and
  is why the mark is kept this plain.
- **The spine gap closes** below roughly 40 px, so the book reads as a single
  card. Intended degradation, not a defect.
- **No App Store artwork yet.** No 1024 marketing icon treatment, no screenshot
  frames and no Play Store feature graphic. The permanent bundle identifier is
  also still unchosen, so none of this is final for release.
