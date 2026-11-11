// Settings rules, and the agreement between the sound list and the app config.
//
// The second part matters more than it looks. A timer sound only works if three
// separate things name the same file: this module's choice list, the
// expo-notifications `sounds` array in app.json (which is what copies the file
// into the bundle), and the file on disk. Getting two of the three right
// produces a timer that is silently silent -- the notification arrives, with no
// sound, and nothing anywhere reports an error. So the test checks all three.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_MEASUREMENT, DEFAULT_TIMER_SOUND, MEASUREMENT_CHOICES, TIMER_SOUND_CHOICES,
  parseMeasurement, parseTimerSound, timerChannelId, timerSoundFile, timerSoundLabel,
} from "../src/settings/settings.ts";

const ROOT = join(import.meta.dirname, "..");

test("a stored measurement is validated on read", () => {
  assert.equal(parseMeasurement("metric"), "metric");
  assert.equal(parseMeasurement("us"), "us");
  assert.equal(parseMeasurement("original"), "original");
  // Anything else -- a value from a later version, a corrupted row, a null
  // from an unopened store -- must land on the faithful default rather than
  // leave the app in a state it cannot render.
  for (const junk of [null, undefined, "", "imperial", 3, {}, "METRIC"]) {
    assert.equal(parseMeasurement(junk), DEFAULT_MEASUREMENT, `junk: ${String(junk)}`);
  }
});

test("the default measurement is the one that cannot be wrong", () => {
  // "original" is the only choice that never converts, so it is the only safe
  // default: a conversion we cannot do reliably must never be the starting
  // state. If this ever changes it should be a deliberate decision, not a drift.
  assert.equal(DEFAULT_MEASUREMENT, "original");
});

test("every measurement choice is offered exactly once", () => {
  const values = MEASUREMENT_CHOICES.map((c) => c.value);
  assert.deepEqual([...values].sort(), ["metric", "original", "us"]);
  assert.equal(new Set(values).size, values.length);
  for (const c of MEASUREMENT_CHOICES) {
    assert.ok(c.label.length > 0 && c.detail.length > 0, `${c.value} needs a label and a detail`);
  }
});

test("a stored timer sound is validated on read", () => {
  assert.equal(parseTimerSound("bell"), "bell");
  assert.equal(parseTimerSound("system"), "system");
  for (const junk of [null, undefined, "", "klaxon", 7, {}]) {
    assert.equal(parseTimerSound(junk), DEFAULT_TIMER_SOUND, `junk: ${String(junk)}`);
  }
});

test("the system sound maps to no file, and each other to its own", () => {
  assert.equal(timerSoundFile("system"), null);
  const files = TIMER_SOUND_CHOICES.filter((c) => c.file).map((c) => c.file);
  assert.ok(files.length >= 2, "a choice of one is not a choice");
  assert.equal(new Set(files).size, files.length, "two sounds share a file");
  for (const f of files) assert.match(f!, /\.wav$/, "iOS accepts wav, aiff or caf");
});

test("each sound gets its own Android channel", () => {
  // Android fixes a channel's sound at creation and will not change it, so the
  // channel ids have to be distinct or the second sound silently plays the
  // first one's. This is the whole reason the app creates several channels.
  const ids = TIMER_SOUND_CHOICES.map((c) => timerChannelId(c.value));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^timers-/);
});

test("a label exists for every sound, including an unknown one", () => {
  for (const c of TIMER_SOUND_CHOICES) assert.equal(timerSoundLabel(c.value), c.label);
  // The interface must still render if a stored value outlives its choice.
  assert.equal(timerSoundLabel("gong" as never), "System default");
});

test("every bundled sound is registered in app.json and present on disk", () => {
  const app = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8"));
  const plugin = app.expo.plugins.find(
    (p: unknown) => Array.isArray(p) && p[0] === "expo-notifications",
  );
  assert.ok(plugin, "expo-notifications is not configured");
  const registered: string[] = plugin[1].sounds ?? [];

  const wanted = TIMER_SOUND_CHOICES.filter((c) => c.file).map((c) => `./assets/sounds/${c.file}`);
  assert.deepEqual(
    [...registered].sort(), [...wanted].sort(),
    "the sound list and app.json's `sounds` array disagree; a file missing from either is a silent timer",
  );

  // The default channel has to be one we actually create.
  const ids = TIMER_SOUND_CHOICES.map((c) => timerChannelId(c.value));
  assert.ok(ids.includes(plugin[1].defaultChannel), "defaultChannel is not one of our channels");

  for (const rel of registered) {
    const bytes = readFileSync(join(ROOT, rel));
    // A real WAV, not a placeholder or a truncated write.
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", `${rel} is not a WAV`);
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WAVE", `${rel} is not a WAV`);
    const samples = (bytes.length - 44) / 2;
    const seconds = samples / bytes.readUInt32LE(24);
    assert.ok(seconds > 0.3, `${rel} is ${seconds.toFixed(2)}s, too short to hear`);
    assert.ok(seconds < 30, `${rel} is ${seconds.toFixed(1)}s; iOS rejects an alert over 30s`);

    // And it has audio in it. A file of digital silence passes every check
    // above and alerts nobody.
    let peak = 0;
    for (let i = 0; i < samples; i += 1) peak = Math.max(peak, Math.abs(bytes.readInt16LE(44 + i * 2)));
    assert.ok(peak > 8000, `${rel} peaks at ${peak}; too quiet to be an alert`);
  }
});
