import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePreference, resolveScheme, nativeOverride, isLargeText, minTouchTarget,
  APPEARANCE_PREFERENCES, DEFAULT_APPEARANCE,
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
