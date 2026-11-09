// RecipeBox brand symbol — vector geometry, single source of truth.
//
// The symbol is a cookbook seen front-on: a rounded cover, a binding rule down
// the left, and a two-leaf sprout. Every variant (app icon, adaptive layers,
// splash, monochrome, wordmark lockups) is generated from the functions here,
// so the shapes can never drift apart between assets.
//
// Colours are not hard-coded: callers pass values read from
// design/tokens/recipebox.tokens.json.

// --- symbol design box -----------------------------------------------------
// Portrait, matching a book's proportions. All coordinates below live in it.
export const BOX = { w: 832, h: 904 };

// The book is built from two filled panels divided by a gap of background:
// a narrow spine and the front cover. Putting the division in the silhouette
// rather than drawing a rule on the cover means the book reads as a book at
// large sizes and collapses gracefully into a single clean card at small ones,
// instead of leaving a stray stroke floating on the face.
const SPINE = { x: 0, y: 0, w: 96, h: 904, r: 38 };
const COVER = { x: 132, y: 0, w: 700, h: 904, r: 96 };

// Sprout, optically centred on the front cover. Leaves are slim (half-width to
// length of about 1:5) so the pair still reads as two leaves rather than one
// mass once the icon is scaled down.
// The stem stops just short of the leaf junction so its cap stays hidden
// behind the leaf bases instead of poking out as a bud between them.
const STEM = { cx: 482, y1: 435, y2: 700, half: 26 };
const LEAF = { ax: 482, ay: 455, len: 320, ctrl: 118, spread: 62 };

const n = (v) => Number(v.toFixed(2));

/** Rounded rectangle as path data. */
function roundedRect({ x, y, w, h, r }) {
  const k = Math.min(r, w / 2, h / 2);
  return [
    `M${n(x + k)} ${n(y)}`,
    `H${n(x + w - k)}`,
    `A${n(k)} ${n(k)} 0 0 1 ${n(x + w)} ${n(y + k)}`,
    `V${n(y + h - k)}`,
    `A${n(k)} ${n(k)} 0 0 1 ${n(x + w - k)} ${n(y + h)}`,
    `H${n(x + k)}`,
    `A${n(k)} ${n(k)} 0 0 1 ${n(x)} ${n(y + h - k)}`,
    `V${n(y + k)}`,
    `A${n(k)} ${n(k)} 0 0 1 ${n(x + k)} ${n(y)}`,
    "Z",
  ].join(" ");
}

/** A stroked vertical line with round caps, as a closed path. */
function verticalBar({ cx, y1, y2, half }) {
  return roundedRect({ x: cx - half, y: y1 - half, w: half * 2, h: y2 - y1 + half * 2, r: half });
}

/**
 * One leaf: a lens bounded by two symmetric quadratic arcs, drawn along +x from
 * the attachment point and then rotated. Quadratics keep both flanks identical
 * and give a clean point at the tip.
 */
function leaf(angleDeg) {
  const t = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const p = (x, y) => [n(LEAF.ax + x * cos - y * sin), n(LEAF.ay + x * sin + y * cos)];

  const [sx, sy] = p(0, 0);
  const [c1x, c1y] = p(LEAF.len / 2, -LEAF.ctrl);
  const [tx, ty] = p(LEAF.len, 0);
  const [c2x, c2y] = p(LEAF.len / 2, LEAF.ctrl);
  return `M${sx} ${sy} Q${c1x} ${c1y} ${tx} ${ty} Q${c2x} ${c2y} ${sx} ${sy} Z`;
}

export const paths = {
  spine: roundedRect(SPINE),
  cover: roundedRect(COVER),
  stem: verticalBar(STEM),
  leafRight: leaf(-LEAF.spread),
  leafLeft: leaf(-(180 - LEAF.spread)),
};

/** The two filled panels that form the book. */
const bodyPaths = [paths.spine, paths.cover];
/** The sprout, which sits on the front cover. */
const markPaths = [paths.stem, paths.leafRight, paths.leafLeft];

/**
 * Symbol body as SVG elements.
 * - two-colour: cover drawn in `cover`, marks drawn on top in `mark`.
 * - knockout:   one even-odd path, marks become holes, so the mark is a true
 *               single-colour silhouette (Android monochrome, stencil uses).
 */
export function symbolBody({ cover, mark, knockout = false }) {
  if (knockout) {
    return `<path fill-rule="evenodd" fill="${cover}" d="${[...bodyPaths, ...markPaths].join(" ")}"/>`;
  }
  return [
    ...bodyPaths.map((d) => `<path fill="${cover}" d="${d}"/>`),
    ...markPaths.map((d) => `<path fill="${mark}" d="${d}"/>`),
  ].join("\n  ");
}

/** Standalone symbol SVG, tightly cropped to the cover. */
export function symbolSvg(opts) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX.w} ${BOX.h}" width="${BOX.w}" height="${BOX.h}" role="img" aria-label="RecipeBox">
  ${symbolBody(opts)}
</svg>
`;
}

/**
 * Square composition: the symbol centred on a canvas, scaled so its height is
 * `fill` of the canvas. Used for the app icon (generous fill) and the Android
 * adaptive foreground (smaller, to stay inside the 66/108 safe zone).
 */
export function squareSvg({ size = 1024, fill, background = null, ...opts }) {
  const s = (size * fill) / BOX.h;
  const x = (size - BOX.w * s) / 2;
  const y = (size - BOX.h * s) / 2;
  const bg = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="RecipeBox">
  ${bg}
  <g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})">
  ${symbolBody(opts)}
  </g>
</svg>
`;
}

/**
 * Horizontal lockup: symbol + wordmark.
 *
 * The wordmark is live <text> in Newsreader, the project's licensed serif
 * (SIL Open Font License 1.1), already bundled in the app via
 * @expo-google-fonts/newsreader. It is deliberately NOT converted to outlines:
 * outlining would mean shipping a second copy of the font's glyph data here,
 * and the app renders the wordmark with the real font anyway. Renderers
 * without Newsreader installed fall back to Georgia or a generic serif.
 */
export function lockupSvg({ cover, mark, ink, background = null }) {
  const symbolH = 200;
  const s = symbolH / BOX.h;
  const symbolW = BOX.w * s;
  const gap = 56;
  const textSize = 164;
  const padX = 48;
  const padY = 56;
  const textW = 745; // measured advance of "RecipeBox" in Newsreader at 164px
  const w = padX * 2 + symbolW + gap + textW;
  const h = padY * 2 + symbolH;
  const bg = background
    ? `<rect width="${n(w)}" height="${n(h)}" rx="${n(h / 5)}" fill="${background}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" width="${n(w)}" height="${n(h)}" role="img" aria-label="RecipeBox">
  ${bg}
  <g transform="translate(${padX} ${padY}) scale(${n(s)})">
  ${symbolBody({ cover, mark })}
  </g>
  <text x="${n(padX + symbolW + gap)}" y="${n(padY + symbolH * 0.78)}"
        font-family="Newsreader, Georgia, 'Times New Roman', serif"
        font-size="${textSize}" font-weight="400" letter-spacing="-2" fill="${ink}">RecipeBox</text>
</svg>
`;
}
