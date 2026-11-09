#!/usr/bin/env node
// Extracts the RecipeBox app assets from the approved concept board.
//
//   cd apps/mobile && npm install --no-save sharp
//   node ../../design/brand/extract.mjs
//
// This is a CROP-AND-RESAMPLE pipeline, not a drawing program. No shape, curve,
// colour or proportion is synthesised. The only pixels this script invents are
// the ones outside the source tile's rounded corners, where a platform demands
// a full-bleed opaque square; those are filled by extending the tile's own edge
// colour outward, which preserves its vertical shading.
//
// Superseded design/brand/geometry.mjs, which drew a reinterpretation of the
// mark. That file is kept for history and is no longer used for app assets.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const assets = join(repo, "apps", "mobile", "assets");
const SOURCE = join(here, "source", "recipebox-concept-board.webp");

let sharp;
try {
  sharp = createRequire(join(assets, "x.js"))("sharp");
} catch {
  console.error("sharp is required.\n  cd apps/mobile && npm install --no-save sharp");
  process.exit(1);
}

// --- crop boxes, measured from the 1448x1086 source by colour-region analysis
// (see design/brand/README.md). Do not nudge these by eye.
// Each box stops short of the board's own specimen captions ("PRIMARY
// WORDMARK", "MONOCHROME (REVERSED)"), which sit well below the artwork.
const CROP = {
  icon:            { left: 1074, top: 161, width: 277, height: 282 },
  lockupLight:     { left: 94,   top: 194, width: 868, height: 216 },
  symbolLight:     { left: 94,   top: 194, width: 188, height: 216 },
  lockupReversed:  { left: 542,  top: 895, width: 392, height: 105 },
};

const ICON_PX = 1024;
// Android keeps key content inside the central 66/108 of the adaptive canvas.
const ADAPTIVE_CONTENT = 0.86;

const written = [];
const note = (p, buf) => written.push([p, buf.length]);

/** Raw RGBA helper. Accepts a path, a buffer, or an existing sharp pipeline. */
async function raw(input) {
  const pipeline = typeof input?.toBuffer === "function" ? input : sharp(input);
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
}

/**
 * Turn the cropped tile into a full-bleed opaque square.
 *
 * The source tile has rounded corners and a soft drop shadow, both sitting on
 * the board's cream. iOS and Android both require an opaque square with no
 * baked corner radius, because they apply their own mask. For every row we
 * find the first and last pixel belonging to the tile and repeat that pixel's
 * colour out to the edge. Only the corner notches and the shadow are touched;
 * the tile's own shading survives because each row is extended with its own
 * colour rather than a single flat fill.
 */
function fullBleed({ data, w, h, c }) {
  const isTile = (r, g, b) => g > r + 14 && g > b + 14 && g > 40 && g < 165 && r < 125;
  const px = (x, y) => {
    const i = (y * w + x) * c;
    return [data[i], data[i + 1], data[i + 2]];
  };

  // Pass 1: per row, locate the tile's span and take a small average just
  // inside each end. Averaging rather than reading one pixel keeps the source's
  // sensor-like noise from being smeared across the whole corner as banding;
  // the edge is skipped by INSET because it is antialiased against the cream.
  const INSET = 2;
  const SAMPLE = 6;
  const spans = [];
  for (let y = 0; y < h; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      if (isTile(r, g, b)) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first < 0 || last - first < SAMPLE * 2) { spans.push(null); continue; }
    const avg = (from, dir) => {
      const t = [0, 0, 0];
      for (let k = 0; k < SAMPLE; k++) {
        const p = px(from + dir * k, y);
        t[0] += p[0]; t[1] += p[1]; t[2] += p[2];
      }
      return t.map((v) => v / SAMPLE);
    };
    spans.push({ first, last, left: avg(first + INSET, 1), right: avg(last - INSET, -1) });
  }

  // Pass 2: smooth those fill colours down the image, so the extended corners
  // follow the tile's vertical shading instead of its row-to-row noise.
  const SMOOTH = 5;
  const smoothed = spans.map((s, y) => {
    if (!s) return null;
    const acc = { left: [0, 0, 0], right: [0, 0, 0] };
    let n = 0;
    for (let k = -SMOOTH; k <= SMOOTH; k++) {
      const o = spans[y + k];
      if (!o) continue;
      for (let j = 0; j < 3; j++) { acc.left[j] += o.left[j]; acc.right[j] += o.right[j]; }
      n++;
    }
    return {
      first: s.first,
      last: s.last,
      left: acc.left.map((v) => Math.round(v / n)),
      right: acc.right.map((v) => Math.round(v / n)),
    };
  });

  const out = Buffer.alloc(w * h * 3);
  let lastGood = null;
  for (let y = 0; y < h; y++) {
    const s = smoothed[y];
    if (!s) {
      // No usable tile span (only possible on the extreme top or bottom row):
      // repeat the nearest row that had one.
      if (lastGood !== null) out.copy(out, y * w * 3, lastGood * w * 3, (lastGood + 1) * w * 3);
      continue;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const [r, g, b] =
        x < s.first + INSET ? s.left : x > s.last - INSET ? s.right : px(x, y);
      out[o] = r; out[o + 1] = g; out[o + 2] = b;
    }
    lastGood = y;
  }
  // Any leading rows before the first usable span: copy the first good row up.
  const firstGood = smoothed.findIndex(Boolean);
  for (let y = 0; y < firstGood; y++) out.copy(out, y * w * 3, firstGood * w * 3, (firstGood + 1) * w * 3);
  return { data: out, w, h, c: 3 };
}

/** Pad a raw RGB image to a square by repeating its edge columns/rows. */
function padToSquare({ data, w, h }) {
  const s = Math.max(w, h);
  const dx = (s - w) >> 1;
  const dy = (s - h) >> 1;
  const out = Buffer.alloc(s * s * 3);
  for (let y = 0; y < s; y++) {
    const sy = Math.min(h - 1, Math.max(0, y - dy));
    for (let x = 0; x < s; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - dx));
      const i = (sy * w + sx) * 3;
      const o = (y * s + x) * 3;
      out[o] = data[i]; out[o + 1] = data[i + 1]; out[o + 2] = data[i + 2];
    }
  }
  return { data: out, w: s, h: s };
}

/** Place a scaled copy of a square RGB image on a larger canvas, repeating edge pixels outward. */
function insetWithEdgeFill(src, size, fraction) {
  const inner = Math.round(size * fraction);
  const off = (size - inner) >> 1;
  const out = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(inner - 1, Math.max(0, y - off));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(inner - 1, Math.max(0, x - off));
      const i = (sy * inner + sx) * 3;
      const o = (y * size + x) * 3;
      out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2];
    }
  }
  return out;
}

const png = (buf, w, h, ch) =>
  sharp(buf, { raw: { width: w, height: h, channels: ch } }).png({ compressionLevel: 9 });

async function save(name, pipeline) {
  const buf = await pipeline.toBuffer();
  writeFileSync(join(assets, name), buf);
  note("apps/mobile/assets/" + name, buf);
}

mkdirSync(assets, { recursive: true });

// --- 1. iOS / Android app icon ---------------------------------------------
const tileRaw = await raw(sharp(SOURCE).extract(CROP.icon));
const square = padToSquare(fullBleed(tileRaw));
const iconBuf = await png(square.data, square.w, square.h, 3)
  .resize(ICON_PX, ICON_PX, { kernel: "lanczos3" })
  .toBuffer();
writeFileSync(join(assets, "icon.png"), iconBuf);
note("apps/mobile/assets/icon.png", iconBuf);

// --- 2. Android adaptive layers --------------------------------------------
// Foreground: the same tile, stepped in so the artwork clears the circle mask,
// with the tile's edge colour carried out to the canvas edge so no seam shows.
const innerPx = Math.round(ICON_PX * ADAPTIVE_CONTENT);
const innerRaw = await sharp(square.data, { raw: { width: square.w, height: square.h, channels: 3 } })
  .resize(innerPx, innerPx, { kernel: "lanczos3" })
  .raw()
  .toBuffer();
await save("android-icon-foreground.png", png(insetWithEdgeFill(innerRaw, ICON_PX, ADAPTIVE_CONTENT), ICON_PX, ICON_PX, 3));

// Background: the tile's own mid green, sampled from the full-bleed square.
const mid = square.data.subarray(
  ((square.h >> 1) * square.w + 4) * 3,
  ((square.h >> 1) * square.w + 5) * 3,
);
const BG = { r: mid[0], g: mid[1], b: mid[2] };
await save(
  "android-icon-background.png",
  sharp({ create: { width: ICON_PX, height: ICON_PX, channels: 3, background: BG } }).png({ compressionLevel: 9 }),
);

// Monochrome: Android tints this layer, so it can only be an alpha silhouette.
// Derived by luminance-keying the ivory artwork out of the green field. This is
// the one asset that cannot be a faithful copy — a shaded raster carries no
// single-colour form — and it is documented as an approximation.
{
  const { data, w, h, c } = await raw(sharp(iconBuf));
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0, o = 0; o < out.length; i += c, o += 4) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const a = Math.max(0, Math.min(255, Math.round((lum - 140) * (255 / 60))));
    out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = a;
  }
  const shrunk = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .resize(Math.round(ICON_PX * 0.62), Math.round(ICON_PX * 0.62), { kernel: "lanczos3" })
    .png()
    .toBuffer();
  await save(
    "android-icon-monochrome.png",
    sharp({ create: { width: ICON_PX, height: ICON_PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: shrunk, gravity: "centre" }])
      .png({ compressionLevel: 9 }),
  );
}

// --- 3. Splash and in-app branding -----------------------------------------
// Cropped straight from the board. The light crops keep the board's cream
// ground (#FAF5EE), which is all but indistinguishable from the app's canvas
// (#F6F5F1); keying it out is not possible because the artwork is cream too.
await save("splash-icon.png", sharp(SOURCE).extract(CROP.symbolLight).resize(512, null, { kernel: "lanczos3" }).png({ compressionLevel: 9 }));
await save("brand-wordmark-light.png", sharp(SOURCE).extract(CROP.lockupLight).resize(1200, null, { kernel: "lanczos3" }).png({ compressionLevel: 9 }));

// The reversed lockup ships with the board's own dark ground rather than being
// keyed to transparency. Keying it washed the cream artwork out: the mark and
// the ground are both soft-edged in a low-resolution raster, so an alpha cut
// along that boundary eats the antialiasing. Keeping the ground is also how
// the board presents this variant.
await save(
  "brand-wordmark-dark.png",
  sharp(SOURCE).extract(CROP.lockupReversed).resize(1200, null, { kernel: "lanczos3" }).png({ compressionLevel: 9 }),
);
// Dark splash: the symbol end of that same reversed lockup.
await save(
  "splash-icon-dark.png",
  sharp(SOURCE)
    .extract({ ...CROP.lockupReversed, width: Math.round(CROP.lockupReversed.width * 0.33) })
    .resize(420, null, { kernel: "lanczos3" })
    .png({ compressionLevel: 9 }),
);

await save("favicon.png", sharp(iconBuf).resize(64, 64, { kernel: "lanczos3" }).png({ compressionLevel: 9 }));

// --- 4. Reference crop, for review only ------------------------------------
// The tile exactly as it sits on the board — rounded corners, drop shadow,
// cream ground, no corner fill — so the shipped icon can be compared against
// its source. Not used by the app.
{
  const buf = await sharp(SOURCE).extract(CROP.icon).resize(512, null, { kernel: "lanczos3" })
    .png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(here, "original-tile.png"), buf);
  note("design/brand/original-tile.png", buf);
}

const pad = Math.max(...written.map(([n]) => n.length));
for (const [n, b] of written) console.log(`  ${n.padEnd(pad)}  ${String(b).padStart(7)} bytes`);
console.log(`\nsource  ${SOURCE.replace(repo + "/", "")}  (1448x1086)`);
console.log(`tile    ${CROP.icon.width}x${CROP.icon.height} px  ->  ${ICON_PX}x${ICON_PX}  (${(ICON_PX / CROP.icon.height).toFixed(2)}x upscale)`);
