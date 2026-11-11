// Generates the bundled timer alert sounds.
//
// They are synthesised here rather than sourced, for two reasons. A licence
// for an audio file is a thing we would have to track and honour for the life
// of the product, and the brief is explicit that sample assets must be
// appropriately licensed; a waveform computed from an equation has no owner but
// us. And a kitchen timer has a narrow job -- it must cut through extractor fan
// and conversation without being unpleasant at arm's length -- which is easier
// to hit by tuning a model than by hunting for a file that happens to fit.
//
// The model is a struck bar: a handful of inharmonic partials, each with its
// own exponential decay, fast partials dying first. That is what makes a struck
// metal object sound struck rather than beeped at. A pure sine with a square
// envelope is the sound of a cheap appliance, and it clicks at both ends.
//
//   node scripts/generate-timer-sounds.mjs           write assets/sounds/*.wav
//   node scripts/generate-timer-sounds.mjs --check    verify they are current
//
// Run it after changing anything here; `--check` is how CI would catch a file
// edited by hand. iOS requires a bundled alert to be under 30 seconds and in
// WAV, AIFF or CAF, so these are short 16-bit mono WAVs.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "assets", "sounds");

const RATE = 44100;

/** Partials of a struck bar, as ratio / amplitude / decay seconds. The ratios
 *  are deliberately not harmonic: a 2.76 and a 5.40 above the fundamental are
 *  what a bar gives, and they are why this reads as metal and not as organ. */
const PARTIALS = [
  { ratio: 1.0, amp: 1.0, decay: 1.0 },
  { ratio: 2.76, amp: 0.42, decay: 0.55 },
  { ratio: 5.4, amp: 0.2, decay: 0.3 },
  { ratio: 8.93, amp: 0.1, decay: 0.16 },
];

/** One strike, written into `buf` starting at `atSec`. Additive, so strikes
 *  may overlap and ring into one another the way two real notes would. */
function strike(buf, atSec, freq, gain, decayScale) {
  const start = Math.round(atSec * RATE);
  const length = Math.round(decayScale * 1.4 * RATE);
  // A few milliseconds of attack. Starting a partial at full amplitude puts a
  // step in the waveform, which is audible as a click on small speakers.
  const attack = Math.round(0.004 * RATE);

  for (let i = 0; i < length; i += 1) {
    const n = start + i;
    if (n >= buf.length) break;
    const t = i / RATE;
    let sample = 0;
    for (const p of PARTIALS) {
      sample += p.amp * Math.exp(-t / (p.decay * decayScale)) * Math.sin(2 * Math.PI * freq * p.ratio * t);
    }
    const ramp = i < attack ? i / attack : 1;
    buf[n] += sample * gain * ramp;
  }
}

/** Normalise to a consistent peak and write 16-bit PCM. Headroom below full
 *  scale leaves the partials room to sum without the sum clipping flat. */
function encodeWav(samples) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const scale = peak > 0 ? (0.89 * 32767) / peak : 0;

  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * scale))), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);          // fmt chunk size
  header.writeUInt16LE(1, 20);           // PCM
  header.writeUInt16LE(1, 22);           // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);    // byte rate
  header.writeUInt16LE(2, 32);           // block align
  header.writeUInt16LE(16, 34);          // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function render(seconds, strikes) {
  const buf = new Float64Array(Math.round(seconds * RATE));
  for (const s of strikes) strike(buf, s.at, s.freq, s.gain ?? 1, s.decay ?? 1);
  return encodeWav(buf);
}

// Three characters, not three variations. A cook picking a sound is choosing
// how much the kitchen is about to be interrupted.
const SOUNDS = {
  // Two notes a fifth apart, the second while the first still rings. Warm and
  // unalarming -- the default for a timer that is a reminder, not an alarm.
  "chime.wav": () => render(2.4, [
    { at: 0, freq: 659.25, gain: 1, decay: 1.0 },   // E5
    { at: 0.17, freq: 987.77, gain: 0.9, decay: 1.2 }, // B5
  ]),
  // One low strike with a long tail. Carries further and sounds more serious,
  // without the repetition of an alarm.
  "bell.wav": () => render(3.2, [
    { at: 0, freq: 440, gain: 1, decay: 1.9 },
  ]),
  // Four quick high strikes. The one to pick when the extractor fan is on and
  // a single note would be missed.
  "ring.wav": () => render(2.4, [
    { at: 0, freq: 1174.66, gain: 1, decay: 0.42 },
    { at: 0.22, freq: 1174.66, gain: 1, decay: 0.42 },
    { at: 0.44, freq: 1174.66, gain: 1, decay: 0.42 },
    { at: 0.66, freq: 1174.66, gain: 1, decay: 0.75 },
  ]),
};

const check = process.argv.includes("--check");
mkdirSync(OUT, { recursive: true });

let stale = 0;
for (const [name, build] of Object.entries(SOUNDS)) {
  const bytes = build();
  const path = join(OUT, name);
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  if (check) {
    let existing = null;
    try { existing = readFileSync(path); } catch { /* missing counts as stale */ }
    if (!existing || !existing.equals(bytes)) {
      console.error(`stale: assets/sounds/${name}`);
      stale += 1;
    }
  } else {
    writeFileSync(path, bytes);
    console.log(`${name.padEnd(10)} ${(bytes.length / 1024).toFixed(0).padStart(4)} KB  sha ${digest}`);
  }
}

if (check) {
  if (stale > 0) {
    console.error(`\n${stale} sound file(s) differ from the generator. Run: npm run sounds`);
    process.exit(1);
  }
  console.log("timer sounds are current");
}
