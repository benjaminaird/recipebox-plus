// Photographs this app holds.
//
// The store takes its file system as a parameter, so these drive the real
// rules against a file system that records what was asked of it. What is
// being tested is the ORDER and the refusals — which is where a photograph
// actually gets lost — rather than whether Expo can copy a file.

import assert from "node:assert/strict";
import test from "node:test";
import {
  adoptPhoto, fileToShow, forgetPhoto, mayForget, pathsFor, repairDerivatives,
  DISPLAY_MAX_EDGE, THUMB_MAX_EDGE, type MediaFiles,
} from "../src/media/store.ts";
import {
  chooseImage, judgeImage, localReference, needsNetwork, parseImageReference,
} from "../src/media/reference.ts";

/** A file system that remembers, and can be told to fail. */
function recordingFiles(over: Partial<MediaFiles> = {}) {
  const present = new Set<string>();
  const log: string[] = [];
  const files: MediaFiles & { _present: Set<string>; _log: string[] } = {
    documents: "/docs/",
    _present: present,
    _log: log,
    async exists(path) { return present.has(path); },
    async makeDirectory(path) { log.push("mkdir " + path); },
    async copy(from, to) { log.push("copy " + from + " -> " + to); present.add(to); },
    async delete(path) {
      log.push("delete " + path);
      for (const p of [...present]) if (p.startsWith(path)) present.delete(p);
    },
    async size() { return 2_400_000; },
    async derive(from, to, maxEdge) {
      log.push("derive " + from + " -> " + to + " @" + maxEdge);
      present.add(to);
      return { width: maxEdge, height: Math.round(maxEdge * 0.75) };
    },
    ...over,
  };
  return files;
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

test("a reference says where a photograph actually is", () => {
  assert.deepEqual(parseImageReference("https://example.test/x.jpg"),
    { kind: "remote", url: "https://example.test/x.jpg" });
  assert.deepEqual(parseImageReference("recipebox://media/abc123"),
    { kind: "local", mediaId: "abc123" });
  assert.deepEqual(parseImageReference("file:///tmp/photo.heic"),
    { kind: "foreign", uri: "file:///tmp/photo.heic" });
  assert.deepEqual(parseImageReference("  "), { kind: "none" });
  assert.deepEqual(parseImageReference(undefined), { kind: "none" });

  // A picker hands back ph:// and content:// too, and both mean the same
  // thing: somewhere else on this device, not yet ours.
  assert.equal(parseImageReference("ph://ABC-123").kind, "foreign");
  assert.equal(parseImageReference("content://media/1").kind, "foreign");

  assert.equal(parseImageReference(localReference("xyz")).kind, "local");
  assert.equal(needsNetwork({ kind: "remote", url: "x" }), true);
  assert.equal(needsNetwork({ kind: "local", mediaId: "x" }), false);
});

// ---------------------------------------------------------------------------
// Choosing an image from a page
// ---------------------------------------------------------------------------

test("furniture is not a photograph of a dish", () => {
  for (const url of [
    "https://site.test/assets/logo.png",
    "https://site.test/img/favicon-32.png",
    "https://site.test/static/sprite-icons.png",
    "https://site.test/u/avatar/123.jpg",
    "https://site.test/pixel.gif",
    "https://site.test/t/tracking?id=1",
    "https://site.test/ads/leaderboard.jpg",
    "https://site.test/img/placeholder.jpg",
    "https://site.test/social-share.png",
    "https://site.test/newsletter-signup.png",
  ]) {
    assert.equal(judgeImage({ url }).ok, false, url);
  }

  // Formats a photograph of food never arrives in.
  assert.equal(judgeImage({ url: "https://site.test/hero.svg" }).reason, "wrong-format");
  assert.equal(judgeImage({ url: "https://site.test/hero.gif" }).reason, "wrong-format");

  // Not a URL at all.
  assert.equal(judgeImage({ url: "/relative/hero.jpg" }).reason, "not-a-url");
  assert.equal(judgeImage({ url: "data:image/png;base64,AAAA" }).reason, "not-a-url");
});

test("a host that happens to contain a banned word is not the file's fault", () => {
  // Matched against the path, not the whole URL. "cdn.logos-example.com"
  // would otherwise disqualify every image a site serves.
  assert.equal(judgeImage({ url: "https://cdn.logos-example.com/recipes/soda-bread.jpg" }).ok, true);
  assert.equal(judgeImage({ url: "https://images.adsite.test/dishes/tart.jpg" }).ok, true);
});

test("dimensions rule out furniture the name did not give away", () => {
  assert.equal(judgeImage({ url: "https://s.test/x.jpg", width: 48, height: 48 }).reason, "too-small");
  // Big enough on both edges, and still plainly a strip rather than a dish.
  assert.equal(judgeImage({ url: "https://s.test/x.jpg", width: 1800, height: 400 }).reason, "wrong-shape");
  // Small on one edge is caught first, which is the same answer by a shorter road.
  assert.equal(judgeImage({ url: "https://s.test/x.jpg", width: 1200, height: 90 }).reason, "too-small");
  assert.equal(judgeImage({ url: "https://s.test/x.jpg", width: 1200, height: 800 }).ok, true);
  // Unstated dimensions are not a reason to refuse: most pages do not say.
  assert.equal(judgeImage({ url: "https://s.test/x.jpg" }).ok, true);
});

test("the publisher's own order is kept, with the furniture removed", () => {
  // Their first image is the one they chose for the recipe. Overriding that
  // with a guess is a heuristic that will eventually be confidently wrong.
  assert.equal(
    chooseImage([
      { url: "https://s.test/logo.png" },
      { url: "https://s.test/recipes/bread.jpg" },
      { url: "https://s.test/recipes/crumb.jpg" },
    ]),
    "https://s.test/recipes/bread.jpg",
  );
  assert.equal(chooseImage([{ url: "https://s.test/logo.png" }]), null,
    "nothing is better than the wrong picture of somebody else's dinner");
  assert.equal(chooseImage([]), null);
});

// ---------------------------------------------------------------------------
// Keeping the original
// ---------------------------------------------------------------------------

test("the original is copied whole, and first", async () => {
  const files = recordingFiles();
  const record = await adoptPhoto(files, "m1", "file:///tmp/IMG_0001.HEIC", 5_000);

  // Order matters: a failure part-way must leave the original present rather
  // than a half-written set with nothing to regenerate from.
  const copyAt = files._log.findIndex((l) => l.startsWith("copy "));
  const deriveAt = files._log.findIndex((l) => l.startsWith("derive "));
  assert.ok(copyAt > -1 && deriveAt > copyAt, "the original lands before any derivative");

  // And it is copied, not resized. The web import downscaled at import time
  // and stored only that; ADR 0008 says no migration can recover the detail.
  assert.ok(files._log.some((l) => l === "copy file:///tmp/IMG_0001.HEIC -> /docs/media/m1/original"));
  assert.ok(!files._log.some((l) => l.startsWith("derive") && l.includes("-> /docs/media/m1/original")));

  assert.equal(record.reference, "recipebox://media/m1");
  assert.equal(record.createdAt, 5_000);
  assert.ok(files._log.some((l) => l.includes("@" + DISPLAY_MAX_EDGE)));
  assert.ok(files._log.some((l) => l.includes("@" + THUMB_MAX_EDGE)));
});

test("adopting the same photograph twice does not copy it twice", async () => {
  const files = recordingFiles();
  await adoptPhoto(files, "m1", "file:///tmp/a.jpg");
  const before = files._log.filter((l) => l.startsWith("copy ")).length;
  await adoptPhoto(files, "m1", "file:///tmp/a.jpg");
  const after = files._log.filter((l) => l.startsWith("copy ")).length;
  assert.equal(before, 1);
  assert.equal(after, 1, "the bytes are already here; a second copy is only a second copy");
});

test("a lost derivative is rebuilt; a lost original is the only real loss", async () => {
  const files = recordingFiles();
  await adoptPhoto(files, "m1", "file:///tmp/a.jpg");
  const paths = pathsFor(files, "m1");

  // iOS may reclaim files the app is not using. A missing thumbnail must not
  // read as a missing photograph.
  files._present.delete(paths.thumb);
  assert.equal(await repairDerivatives(files, "m1"), true);
  assert.ok(files._present.has(paths.thumb));

  files._present.delete(paths.original);
  assert.equal(await repairDerivatives(files, "m1"), false, "nothing to rebuild from");
});

test("what to show falls back towards the original, never towards nothing", async () => {
  const files = recordingFiles();
  await adoptPhoto(files, "m1", "file:///tmp/a.jpg");
  const paths = pathsFor(files, "m1");

  assert.equal(await fileToShow(files, "m1", "thumb"), paths.thumb);

  files._present.delete(paths.thumb);
  assert.equal(await fileToShow(files, "m1", "thumb"), paths.display,
    "a missing thumbnail is a performance problem, not a blank");

  files._present.delete(paths.display);
  assert.equal(await fileToShow(files, "m1", "thumb"), paths.original);

  files._present.delete(paths.original);
  assert.equal(await fileToShow(files, "m1", "thumb"), null);
});

test("a failed upload never deletes the only copy", () => {
  // The single worst thing this module could do. A photograph that has not
  // reached the account may be the only one in existence, and a recipe on
  // another device may still be waiting for it.
  assert.equal(mayForget({ inUse: false, uploadedAt: null, removedByCook: false }), false);
  assert.equal(mayForget({ inUse: true, uploadedAt: 1, removedByCook: true }), false,
    "still named by a recipe here");
  assert.equal(mayForget({ inUse: false, uploadedAt: 1, removedByCook: false }), true,
    "another copy exists");
  assert.equal(mayForget({ inUse: false, uploadedAt: null, removedByCook: true }), true,
    "the cook asked, which is the one thing that outranks caution");
});

test("forgetting a photograph takes its whole folder", async () => {
  const files = recordingFiles();
  await adoptPhoto(files, "m1", "file:///tmp/a.jpg");
  await forgetPhoto(files, "m1");
  assert.equal(files._present.size, 0);
  assert.equal(await fileToShow(files, "m1", "display"), null);
});

test("only references this app understands may reach an image loader", () => {
  // `heroImage` is not ours. It arrives from a web page the cook imported and
  // from the account's sync feed, and an <Image> fetches whatever it is
  // handed: a file:// would read this device's own files into a view, and an
  // http:// to a private address is a request made from inside the cook's
  // network — either one a beacon that fires the moment a list scrolls past.
  //
  // The rule lives in parseImageReference, so this pins down what each shape
  // resolves to rather than re-implementing the check.
  const allowed = (value: string) => {
    const reference = parseImageReference(value);
    if (reference.kind === "remote") return /^https:\/\//i.test(reference.url);
    return reference.kind === "local";
  };

  assert.equal(allowed("https://site.test/bread.jpg"), true);
  assert.equal(allowed("recipebox://media/m1"), true);

  assert.equal(allowed("http://site.test/bread.jpg"), false, "cleartext is a beacon too");
  assert.equal(allowed("http://192.168.1.1/admin.png"), false);
  assert.equal(allowed("file:///etc/passwd"), false);
  assert.equal(allowed("file:///var/mobile/Containers/Data/x.jpg"), false,
    "a bare path is not a reference; adopting it is what makes it one");
  assert.equal(allowed("data:image/png;base64,AAAA"), false);
  assert.equal(allowed("javascript:alert(1)"), false);
  assert.equal(allowed(""), false);
});
