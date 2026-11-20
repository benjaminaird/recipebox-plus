// Photographs this app holds, on the device.
//
// ADR 0008 in its local half: originals at full quality, display derivatives
// beside them, and references rather than bytes in the recipe. The ADR's
// other half — private object storage — needs a server contract that does not
// exist yet; what is here is written so that adding it is a new field on a
// row, not a rewrite. `docs/native-media-contract.md` says what the server
// has to provide.
//
// Three rules, each of which is a way a photograph gets lost:
//
//   The original is never the thing that gets resized. The old web import
//   downscaled to 1280px at quality 0.7 AT IMPORT TIME and stored only that,
//   which is why ADR 0008 says no migration can recover the detail. A
//   handwritten card photographed by a grandchild is not input to an
//   extractor; it is the artifact. The derivative is a second file.
//
//   A stored path is not a reference. iOS rewrites the app container's path
//   on reinstall and between builds, so an absolute path written today is a
//   file not found tomorrow. The id is stable; the path is computed from it.
//
//   Nothing deletes the only copy. Replacing a photograph writes the new one
//   first; a failed upload never removes a local original, because the local
//   original may be the only one there is.
//
// The file system is a parameter, so the rules can be tested without a
// device: see `MediaFiles`.

import { localReference } from "./reference.ts";

/** The slice of the file system this module uses. */
export type MediaFiles = {
  /** Absolute path of the app's private documents directory, with a trailing slash. */
  documents: string;
  exists(path: string): Promise<boolean>;
  makeDirectory(path: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
  size(path: string): Promise<number>;
  /** Write a display-sized copy. Returns where it was written. */
  derive(from: string, to: string, maxEdge: number): Promise<{ width: number; height: number }>;
};

/**
 * The longest edge of a display copy.
 *
 * Sized for a recipe shown full width on a large phone at 3x, with room to
 * spare — not for archival. The original is what archives.
 */
export const DISPLAY_MAX_EDGE = 1600;

/** And for a list, where a hundred of them may be on screen at once. */
export const THUMB_MAX_EDGE = 320;

export type MediaRecord = {
  mediaId: string;
  /** The reference stored on the recipe. */
  reference: string;
  originalPath: string;
  displayPath: string;
  thumbPath: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: number;
};

const folder = (files: MediaFiles, mediaId: string) => files.documents + "media/" + mediaId + "/";

/** Where a media id's files live. Computed, never stored: see the header. */
export function pathsFor(files: MediaFiles, mediaId: string): {
  dir: string; original: string; display: string; thumb: string;
} {
  const dir = folder(files, mediaId);
  return {
    dir,
    original: dir + "original",
    display: dir + "display.jpg",
    thumb: dir + "thumb.jpg",
  };
}

/**
 * Take a photograph into the store.
 *
 * The original is copied first and copied whole. Only once it is safely in
 * place are the derivatives made, so a failure part-way leaves the original
 * present rather than a half-written set with nothing to regenerate from.
 *
 * @param mediaId supplied rather than generated, so the same photograph
 * adopted twice is one record instead of two.
 */
export async function adoptPhoto(
  files: MediaFiles,
  mediaId: string,
  sourceUri: string,
  now = Date.now(),
): Promise<MediaRecord> {
  const paths = pathsFor(files, mediaId);
  await files.makeDirectory(paths.dir);

  // Whole, and first. Everything else can be rebuilt from it; it cannot be
  // rebuilt from anything.
  if (!(await files.exists(paths.original))) {
    await files.copy(sourceUri, paths.original);
  }

  const display = await files.derive(paths.original, paths.display, DISPLAY_MAX_EDGE);
  await files.derive(paths.original, paths.thumb, THUMB_MAX_EDGE);

  return {
    mediaId,
    reference: localReference(mediaId),
    originalPath: paths.original,
    displayPath: paths.display,
    thumbPath: paths.thumb,
    bytes: await files.size(paths.original),
    width: display.width,
    height: display.height,
    createdAt: now,
  };
}

/**
 * Rebuild the derivatives from the original.
 *
 * The recovery when a cache has been evicted — iOS may reclaim files the app
 * is not using, and a missing thumbnail must not read as a missing
 * photograph. Returns false when even the original has gone, which is the
 * only case where the photograph is genuinely lost.
 */
export async function repairDerivatives(
  files: MediaFiles, mediaId: string,
): Promise<boolean> {
  const paths = pathsFor(files, mediaId);
  if (!(await files.exists(paths.original))) return false;
  if (!(await files.exists(paths.display))) {
    await files.derive(paths.original, paths.display, DISPLAY_MAX_EDGE);
  }
  if (!(await files.exists(paths.thumb))) {
    await files.derive(paths.original, paths.thumb, THUMB_MAX_EDGE);
  }
  return true;
}

/**
 * Which file to show, for a given purpose.
 *
 * Falls back towards the original rather than towards nothing: a missing
 * thumbnail is a performance problem, and showing the full-size image is a
 * far better answer to it than showing a blank.
 */
export async function fileToShow(
  files: MediaFiles, mediaId: string, purpose: "thumb" | "display",
): Promise<string | null> {
  const paths = pathsFor(files, mediaId);
  const preferred = purpose === "thumb" ? paths.thumb : paths.display;
  if (await files.exists(preferred)) return preferred;
  if (purpose === "thumb" && (await files.exists(paths.display))) return paths.display;
  if (await files.exists(paths.original)) return paths.original;
  return null;
}

/**
 * Remove a photograph this app holds.
 *
 * Only ever called for media the cook has removed from a recipe, or for a
 * shared recipe whose access has gone. Never as cleanup after a failed
 * upload: the local original may be the only copy in existence, and deleting
 * it because a network request failed would be the single worst thing this
 * module could do.
 */
export async function forgetPhoto(files: MediaFiles, mediaId: string): Promise<void> {
  const paths = pathsFor(files, mediaId);
  await files.delete(paths.dir);
}

/**
 * Whether a photograph may be thrown away yet.
 *
 * Kept separate from doing it, because the question has a real answer that is
 * worth testing on its own: a photograph that has not reached the account is
 * not safe to delete merely because the cook detached it from a recipe — the
 * recipe may still be on another device, waiting for it.
 */
export function mayForget(record: {
  /** Still named by a recipe on this device. */
  inUse: boolean;
  /** Reached the account, so another copy exists. */
  uploadedAt: number | null;
  /** The cook asked for it to go, rather than it merely being unused. */
  removedByCook: boolean;
}): boolean {
  if (record.inUse) return false;
  if (record.removedByCook) return true;
  return record.uploadedAt !== null;
}
