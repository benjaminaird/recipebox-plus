#!/usr/bin/env node
// Regenerates every RecipeBox brand asset from design/brand/geometry.mjs.
//
//   cd apps/mobile && npm install --no-save sharp
//   node ../../design/brand/build.mjs
//
// sharp is deliberately NOT a dependency of apps/mobile: it carries large
// prebuilt binaries, it is only needed when the artwork changes, and keeping it
// out of package.json keeps `npm ci` and CI unchanged. Install it on demand.
//
// Colours come from design/tokens/recipebox.tokens.json, so the brand can never
// drift from the Modern Cookbook palette (ADR 0018, ADR 0019).

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { symbolSvg, squareSvg, lockupSvg } from "./geometry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const assets = join(repo, "apps", "mobile", "assets");

let sharp;
try {
  sharp = createRequire(join(assets, "x.js"))("sharp");
} catch {
  try {
    sharp = createRequire(import.meta.url)("sharp");
  } catch {
    console.error(
      "sharp is required to rasterise the SVG masters.\n" +
        "  cd apps/mobile && npm install --no-save sharp\n" +
        "then re-run this script.",
    );
    process.exit(1);
  }
}

const tokens = JSON.parse(readFileSync(join(repo, "design", "tokens", "recipebox.tokens.json"), "utf8"));
const c = (name, appearance) => {
  const t = tokens.color[name];
  if (!t || !t[appearance]) throw new Error(`unknown token color.${name}.${appearance}`);
  return t[appearance];
};

// Palette, straight from the tokens.
const GREEN = c("accent", "light"); // #2B5B45 botanical green
const IVORY = c("onAccent", "dark"); // #F6F3EC warm ivory on an accent fill
const SAGE = c("accentText", "dark"); // #9FCDB0 sage, the dark-appearance green
const NEAR_BLACK = c("canvas", "dark"); // #141413
const INK = c("text", "light"); // #1C1D1B
const INK_DARK = c("text", "dark"); // #EEE9DF

mkdirSync(here, { recursive: true });
mkdirSync(assets, { recursive: true });

const written = [];
const svg = (name, body) => {
  const p = join(here, name);
  writeFileSync(p, body);
  written.push(["design/brand/" + name, Buffer.byteLength(body)]);
  return body;
};
const png = async (name, body, size) => {
  const p = join(assets, name);
  const buf = await sharp(Buffer.from(body)).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(p, buf);
  written.push(["apps/mobile/assets/" + name, buf.length]);
};

// --- SVG masters -----------------------------------------------------------
// Standalone symbol, for use on a light surface: green cover, ivory marks.
const symbolLight = svg("symbol-light.svg", symbolSvg({ cover: GREEN, mark: IVORY }));
// Dark surfaces: the sage green carries the botanical identity at low light.
const symbolDark = svg("symbol-dark.svg", symbolSvg({ cover: SAGE, mark: NEAR_BLACK }));
// One colour, marks knocked out. Stencils, Android monochrome, print.
svg("symbol-mono.svg", symbolSvg({ cover: INK, knockout: true }));

// App icon: green field, ivory cover, green marks. No baked rounded corners —
// iOS and Android mask it themselves.
const appIcon = svg("app-icon.svg", squareSvg({ fill: 0.62, background: GREEN, cover: IVORY, mark: GREEN }));

// Horizontal lockups.
svg("lockup-light.svg", lockupSvg({ cover: GREEN, mark: IVORY, ink: INK }));
svg("lockup-dark.svg", lockupSvg({ cover: SAGE, mark: NEAR_BLACK, ink: INK_DARK, background: NEAR_BLACK }));

// --- app assets ------------------------------------------------------------
await png("icon.png", appIcon, 1024);

// Android adaptive. The foreground must keep its key shape inside the central
// 66/108 of the canvas, so it is scaled down relative to the iOS icon.
await png(
  "android-icon-foreground.png",
  squareSvg({ fill: 0.5, cover: IVORY, mark: GREEN }),
  1024,
);
await png(
  "android-icon-background.png",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="${GREEN}"/></svg>\n`,
  1024,
);
// Monochrome: the system tints this layer, so it ships as one flat colour with
// the marks knocked out to transparency.
await png(
  "android-icon-monochrome.png",
  squareSvg({ fill: 0.5, cover: INK, knockout: true }),
  1024,
);

// Splash: the bare symbol on a transparent field; expo-splash-screen supplies
// the canvas colour per appearance.
await png("splash-icon.png", symbolLight, 512);
await png("splash-icon-dark.png", symbolDark, 512);

// In-app header mark.
await png("brand-symbol-light.png", symbolLight, 256);
await png("brand-symbol-dark.png", symbolDark, 256);

// Web favicon.
await png("favicon.png", appIcon, 64);

const pad = Math.max(...written.map(([n]) => n.length));
for (const [name, bytes] of written) {
  console.log(`  ${name.padEnd(pad)}  ${String(bytes).padStart(7)} bytes`);
}
console.log(`\n${written.length} files written.`);
