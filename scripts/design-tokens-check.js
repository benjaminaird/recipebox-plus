#!/usr/bin/env node
// Validates design/tokens/recipebox.tokens.json:
//  1. every colour token defines both a light and a dark value;
//  2. every contrast pair meets its minimum in BOTH appearances (WCAG 2.x formula).
// Read-only. Touches nothing in the web app.
"use strict";
const path = require("path");
const tokens = require(path.join(__dirname, "..", "design", "tokens", "recipebox.tokens.json"));

function parse(c) {
  c = String(c).trim();
  let m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) { const n = parseInt(m[1], 16); return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255, a: 1 }; }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) { const p = m[1].split(",").map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  throw new Error("Unparseable colour " + c);
}
function over(fg, bg) { // composite a translucent colour over an opaque one
  return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
}
function lum({ r, g, b }) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

let failures = 0;
const colors = tokens.color;
for (const [name, v] of Object.entries(colors)) {
  for (const ap of tokens.appearances) {
    if (!v[ap]) { console.error(`missing ${ap} value for color.${name}`); failures++; }
    else parse(v[ap]);
  }
}
const rows = [];
for (const [fg, bg, min] of tokens.contrast.pairs) {
  for (const ap of tokens.appearances) {
    if (!colors[fg] || !colors[bg]) { console.error(`unknown token in pair ${fg}/${bg}`); failures++; continue; }
    const B = parse(colors[bg][ap]);
    const base = B.a < 1 ? over(B, parse(colors.canvas[ap])) : B;
    const F = over(parse(colors[fg][ap]), base);
    const r = ratio(F, base);
    const ok = r >= min;
    if (!ok) failures++;
    rows.push(`${ok ? "pass" : "FAIL"}  ${ap.padEnd(5)}  ${(fg + " on " + bg).padEnd(36)} ${r.toFixed(2).padStart(6)}:1  (min ${min})`);
  }
}
console.log(rows.join("\n"));
if (failures) { console.error(`\ndesign-tokens-check: ${failures} failure(s)`); process.exit(1); }
console.log(`\ndesign-tokens-check: ok (${Object.keys(colors).length} colour tokens × ${tokens.appearances.length} appearances, ${tokens.contrast.pairs.length} contrast pairs)`);
