// What a recipe's `heroImage` can be, and how to tell.
//
// Pure. No file system, no network, no React Native.
//
// Three kinds of reference end up in that one field, and conflating them is
// how an image gets lost:
//
//   An http(s) URL, from a website import. The publisher's image, on the
//   publisher's server. It is not ours, it can disappear, and it needs the
//   network.
//
//   A local reference, `recipebox://media/<id>`, for a photograph taken or
//   chosen on this phone. The bytes are in this app's documents directory,
//   and the path they are at is NOT stable: iOS rewrites the container path
//   on reinstall and between builds, so a stored absolute path is a file that
//   cannot be found the next time the app is updated. The id is stable; the
//   path is resolved from it each time.
//
//   Nothing at all.
//
// A raw file:// path is accepted when reading, because that is what the image
// picker hands back and what older code may have written, but it is never
// what gets stored: `adopt` is the step that turns one into a reference this
// app owns.

/** The scheme that means "this app's own media store". */
const LOCAL_PREFIX = "recipebox://media/";

/**
 * What a media id may be made of.
 *
 * It becomes a directory name, and `heroImage` is not ours: it arrives from
 * a web page the cook imported and from the account's sync feed. An id of
 * `../../../Library/Preferences` would read — and, through forgetPhoto,
 * DELETE — somewhere it has no business being. The characters this app
 * actually generates are letters, digits and hyphens; anything else is not a
 * media id and is treated as no photograph at all.
 */
const MEDIA_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isMediaId(value: string): boolean {
  return MEDIA_ID.test(value);
}

export type ImageReference =
  | { kind: "remote"; url: string }
  | { kind: "local"; mediaId: string }
  /** A path from outside, not yet taken into the store. */
  | { kind: "foreign"; uri: string }
  | { kind: "none" };

export function parseImageReference(value: string | null | undefined): ImageReference {
  const raw = (value ?? "").trim();
  if (!raw) return { kind: "none" };
  if (raw.startsWith(LOCAL_PREFIX)) {
    const mediaId = raw.slice(LOCAL_PREFIX.length).trim();
    return isMediaId(mediaId) ? { kind: "local", mediaId } : { kind: "none" };
  }
  if (/^https?:\/\//i.test(raw)) return { kind: "remote", url: raw };
  // file://, ph://, content://, assets-library:// — all of them mean "somewhere
  // else on this device", and all of them need adopting before they are
  // trustworthy as a recipe's photograph.
  return { kind: "foreign", uri: raw };
}

export function localReference(mediaId: string): string {
  return LOCAL_PREFIX + mediaId;
}

/**
 * Whether this reference needs the network to show.
 *
 * The offline question, asked once rather than at every call site. A remote
 * image is the publisher's and may be unreachable on a train; a local one is
 * bytes this app holds and always works.
 */
export function needsNetwork(reference: ImageReference): boolean {
  return reference.kind === "remote";
}

// ---------------------------------------------------------------------------
// Choosing an image from a page
// ---------------------------------------------------------------------------

/**
 * Whether a URL found on a page is plausibly a recipe's photograph.
 *
 * The extractor takes the image the publisher names in their structured data,
 * which is the right source and usually correct. This is the guard for
 * everything else: a logo, a tracking pixel, an avatar, a share button, an
 * advertisement. A wrong image is worse than none — it is a picture of
 * somebody else's dinner attached to this cook's recipe, and it looks
 * deliberate.
 *
 * Conservative in the honest direction: when it cannot tell, it says no. A
 * recipe with no photograph has a perfectly good card.
 */
const REJECT = [
  /\blogo\b/i, /\bicon\b/i, /\bfavicon\b/i, /\bsprite\b/i, /\bavatar\b/i,
  /\bbadge\b/i, /\bbanner\b/i, /\bad[-_]/i, /\bads?\b/i, /\bdoubleclick\b/i,
  /\bpixel\b/i, /\btracking\b/i, /\bbeacon\b/i, /\bplaceholder\b/i,
  /\bspacer\b/i, /\bblank\b/i, /\bshare\b/i, /\bsocial\b/i, /\bemoji\b/i,
  /\bgravatar\b/i, /\bwidget\b/i, /\bsubscribe\b/i, /\bnewsletter\b/i,
];

/** Formats that are never a photograph of food. */
const REJECT_EXTENSION = /\.(svg|gif|ico|bmp)(\?|#|$)/i;

export type ImageCandidate = {
  url: string;
  /** Pixel dimensions where the page stated them. */
  width?: number;
  height?: number;
};

export type ImageVerdict = {
  ok: boolean;
  reason:
    | "accepted"
    | "not-a-url"
    | "looks-like-chrome"
    | "wrong-format"
    | "too-small"
    | "wrong-shape";
};

/** Below this on either side, it is furniture rather than a photograph. */
const MIN_EDGE = 200;
/** A banner or a strip: wider than this ratio is not a photograph of a dish. */
const MAX_RATIO = 3;

export function judgeImage(candidate: ImageCandidate): ImageVerdict {
  const url = (candidate.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: "not-a-url" };
  if (REJECT_EXTENSION.test(url)) return { ok: false, reason: "wrong-format" };

  // Matched against the path only. A host like "cdn.logos-example.com" would
  // otherwise disqualify every image a site serves, and the words that give a
  // file away are in its name.
  const path = url.replace(/^https?:\/\/[^/]+/i, "");
  if (REJECT.some((pattern) => pattern.test(path))) {
    return { ok: false, reason: "looks-like-chrome" };
  }

  const { width, height } = candidate;
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    if (width < MIN_EDGE || height < MIN_EDGE) return { ok: false, reason: "too-small" };
    const ratio = width > height ? width / height : height / width;
    if (ratio > MAX_RATIO) return { ok: false, reason: "wrong-shape" };
  }

  return { ok: true, reason: "accepted" };
}

/**
 * The best candidate, or nothing.
 *
 * Order is the publisher's: the first image they named in their structured
 * data is the one they chose for the recipe. This does not try to pick a
 * better one — it filters out what is plainly not a photograph and keeps
 * their ordering, because a heuristic that overrides an explicit statement
 * is a heuristic that will eventually be confidently wrong.
 */
export function chooseImage(candidates: readonly ImageCandidate[]): string | null {
  for (const candidate of candidates) {
    if (judgeImage(candidate).ok) return candidate.url.trim();
  }
  return null;
}
