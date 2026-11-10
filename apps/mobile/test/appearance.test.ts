import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePreference, resolveScheme, nativeOverride, isLargeText, minTouchTarget,
  APPEARANCE_PREFERENCES, DEFAULT_APPEARANCE, artworkScale, MAX_ARTWORK_SCALE,
} from "../src/theme/appearance.ts";
import { colors } from "../src/theme/tokens.generated.ts";

test("System is the default, and unknown stored values fall back to it", () => {
  assert.equal(DEFAULT_APPEARANCE, "system");
  assert.deepEqual([...APPEARANCE_PREFERENCES], ["system", "light", "dark"]);
  for (const bad of [null, undefined, "", "Dark", "auto", 1, {}]) assert.equal(parsePreference(bad), "system");
  for (const ok of ["system", "light", "dark"] as const) assert.equal(parsePreference(ok), ok);
});

test("System follows the device; Light and Dark ignore it", () => {
  assert.equal(resolveScheme("system", "dark"), "dark");
  assert.equal(resolveScheme("system", "light"), "light");
  assert.equal(resolveScheme("system", null), "light");
  assert.equal(resolveScheme("light", "dark"), "light");
  assert.equal(resolveScheme("dark", "light"), "dark");
});

test("native override: System resets to auto so the OS setting applies live", () => {
  assert.equal(nativeOverride("system"), "auto");
  assert.equal(nativeOverride("light"), "light");
  assert.equal(nativeOverride("dark"), "dark");
});

test("large-text layouts start at 1.35x", () => {
  assert.equal(isLargeText(1), false);
  assert.equal(isLargeText(1.34), false);
  assert.equal(isLargeText(1.35), true);
  assert.equal(isLargeText(2), true);
  assert.equal(isLargeText(Number.NaN), false);
});

test("touch targets: 44 pt on iOS, 48 dp on Android", () => {
  assert.equal(minTouchTarget("ios"), 44);
  assert.equal(minTouchTarget("android"), 48);
});

test("generated tokens: both appearances define exactly the same names, never pure black or white text grounds", () => {
  assert.deepEqual(Object.keys(colors.light).sort(), Object.keys(colors.dark).sort());
  assert.notEqual(colors.dark.canvas.toUpperCase(), "#000000");
  assert.notEqual(colors.dark.text.toUpperCase(), "#FFFFFF");
  assert.notEqual(colors.light.canvas.toUpperCase(), "#FFFFFF");
});

// Regression: the brand header once filled the whole screen because the font
// scale arrived non-finite, `height: NaN` was discarded by the layout engine,
// and the 512x592 artwork fell back to its intrinsic size. A bad scale must
// degrade to 1, never to NaN.
test("artworkScale never yields a non-finite size", () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, "1.2", {}, 0, -1]) {
    const s = artworkScale(bad as never);
    assert.equal(s, 1, `expected 1 for ${String(bad)}`);
    assert.ok(Number.isFinite(34 * s));
  }
});

test("artworkScale follows the font scale up to the cap", () => {
  assert.equal(artworkScale(1), 1);
  assert.equal(artworkScale(1.25), 1.25);
  assert.equal(artworkScale(3), MAX_ARTWORK_SCALE);
  assert.equal(artworkScale(0.85), 0.85, "a smaller text setting shrinks the mark too");
  assert.equal(artworkScale(3, Number.POSITIVE_INFINITY), 3, "an uncapped read passes through");
});
