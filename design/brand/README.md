# RecipeBox brand assets

The RecipeBox identity is the approved concept board: a green rounded-square
cookbook icon with fanned pages and a two-leaf botanical motif, and an editorial
serif wordmark.

**The app's assets are cropped from that board. They are not redrawn.**
[`extract.mjs`](./extract.mjs) is a crop-and-resample pipeline: it synthesises no
shape, curve, colour or proportion.

## Source

| | |
| --- | --- |
| File | [`source/recipebox-concept-board.webp`](./source/recipebox-concept-board.webp) |
| Size | 1448 × 1086 |
| SHA-256 | `617f4861a55553f3fd020be76ebe5bd362eab4c98107120644dacc772172088c` |
| Supplied | 2026-11-08 by the product owner |

Keep this file. Every asset is derived from it, and the crop boxes below are
meaningless against any other version of the board.

## Regenerating

```sh
cd apps/mobile
npm install --no-save sharp
node ../../design/brand/extract.mjs
```

`sharp` is deliberately not a dependency of `apps/mobile`: it ships large
prebuilt binaries and is only needed when the artwork changes, so leaving it out
keeps `npm ci` and the CI mobile job unchanged.

## Crop boxes

Measured from the source by colour-region analysis, not by eye. Each box stops
short of the board's own specimen captions ("PRIMARY WORDMARK", "MONOCHROME
(REVERSED)"), which sit below the artwork and were caught by the first two
attempts at this.

| Region | left | top | width | height |
| --- | --- | --- | --- | --- |
| App icon tile | 1074 | 161 | 277 | 282 |
| Primary lockup | 94 | 194 | 868 | 216 |
| Symbol only | 94 | 194 | 188 | 216 |
| Reversed lockup | 542 | 895 | 392 | 105 |

## What ships

| File | From | Notes |
| --- | --- | --- |
| `icon.png` | icon tile | 1024², opaque, full bleed |
| `android-icon-foreground.png` | icon tile | Stepped in to clear the circle mask |
| `android-icon-background.png` | icon tile | Flat mid-green sampled from the tile |
| `android-icon-monochrome.png` | icon tile | Derived silhouette — see limitations |
| `splash-icon.png` | symbol only | Light appearance |
| `splash-icon-dark.png` | reversed lockup | Dark appearance |
| `brand-wordmark-light.png` | primary lockup | In-app header, light |
| `brand-wordmark-dark.png` | reversed lockup | In-app header, dark |
| `favicon.png` | icon tile | Expo web |

## Limitations

These are consequences of the source, recorded rather than designed around.

**Resolution.** The icon tile is 277 × 282 in the source and is upscaled 3.63×
to reach the 1024² that iOS and Android require. Lanczos-3 resampling keeps it
as clean as the source allows, but the result is soft at full size, and the
board's own compression artefacts are magnified with it. A genuinely sharp icon
needs the artwork redrawn as vectors or re-exported from whatever produced the
board at 1024² or larger. **No sharpening is applied**, because unsharp masking
at this ratio pulls halos out of those artefacts.

**Rounded corners.** The source tile has rounded corners, a soft drop shadow and
sits on the board's cream. iOS and Android both require an opaque square with no
baked radius, because they apply their own mask. `fullBleed()` extends each
row's own edge colour outward to fill the corner notches and cover the shadow.
Only pixels outside the original tile change, and extending per row rather than
flood-filling preserves the tile's vertical shading. The tile's own soft edge
remains faintly visible at the corners and is mostly hidden by the platform
mask.

**Android adaptive layers.** Android expects a foreground and a background it
can move independently. The source is one finished tile with its background
baked in, and separating them would mean inpainting behind the artwork. Instead
the foreground is the whole tile, stepped in to `ADAPTIVE_CONTENT` so the
artwork clears the circle mask, with the tile's edge colour carried to the
canvas edge so no seam shows. The background is a flat sample of the tile's mid
green and is only visible if a launcher offsets the layers.

**Monochrome.** The Android monochrome layer must be a single-colour silhouette
with an alpha channel. A shaded raster carries no such form, so this one asset
*is* derived: the ivory artwork is luminance-keyed out of the green field. It is
the only file here that is not a straight crop, and it is an approximation.

**The reversed lockup keeps its dark ground.** Keying it to transparency washed
the cream artwork out — mark and ground are both soft-edged at this resolution,
so an alpha cut along that boundary eats the antialiasing. Against the app's
canvas (`#141413`) the board's ground (about `#37322A`) reads as a slightly
lighter rounded chip.

**The light crops keep the board's cream ground** (`#FAF5EE`). It cannot be keyed
out because the artwork is cream too. Against the app's light canvas
(`#F6F5F1`) the difference is about four levels and is not visible in practice.

**Colour.** The board's green is an olive, roughly `rgb(82,107,51)` at the top of
the tile shading to `rgb(58,79,35)` at the bottom. That is **not** the product's
`accent` token `#2B5B45`. The artwork keeps its own colour, as approved; the
rest of the app keeps the token palette.

## Superseded

[`superseded-geometry/`](./superseded-geometry/) holds an earlier attempt that
*redrew* the mark from primitives instead of using the approved artwork. It was
rejected. Nothing in the app references it. It is kept only so the history of
the decision is legible.

## Checking the artwork

[`contact-sheet.html`](./contact-sheet.html) shows the extracted icon beside the
original tile, at iPhone Home Screen sizes, with the lockups and splash on both
appearances. It needs to be served, not opened from `file://`:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

then open `http://127.0.0.1:8765/design/brand/contact-sheet.html`.

## Naming

The app is **RecipeBox**, internally and on the device. "RecipeBox — Your
Kitchen, Saved" is a provisional marketing subtitle only; it is not in
`app.json` and not on any store listing. A competing RecipeBox already exists on
the App Store, and trademark clearance is an open pre-launch requirement.
