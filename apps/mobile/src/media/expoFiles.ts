// The media store's file system, as Expo provides it.
//
// Thin by design: every rule about what gets written, in what order, and what
// may be deleted lives in `store.ts`, which takes this as a parameter and is
// therefore testable without a device. What is here is the translation, and
// the two places Expo's shape does not match what the store needs.

import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import type { MediaFiles } from "./store.ts";

export function expoMediaFiles(): MediaFiles {
  return {
    documents: FileSystem.documentDirectory ?? "",

    async exists(path) {
      const info = await FileSystem.getInfoAsync(path);
      return info.exists;
    },

    async makeDirectory(path) {
      // Expo throws if it is already there; the store calls this on every
      // adopt, including a second adopt of the same photograph.
      await FileSystem.makeDirectoryAsync(path, { intermediates: true }).catch(() => {});
    },

    async copy(from, to) {
      await FileSystem.copyAsync({ from, to });
    },

    async delete(path) {
      await FileSystem.deleteAsync(path, { idempotent: true });
    },

    async size(path) {
      const info = await FileSystem.getInfoAsync(path);
      return info.exists && typeof info.size === "number" ? info.size : 0;
    },

    /**
     * A display copy, no larger than `maxEdge` on its longest side.
     *
     * Resized by width or by height depending on which is longer, because
     * asking for a width on a portrait photograph makes it taller than the
     * limit, not shorter. Expo keeps the aspect ratio when given one
     * dimension, so only one is passed.
     *
     * Re-encoding also drops the metadata the original carries — including
     * the GPS coordinates of somebody's kitchen, which have no business
     * travelling with a recipe that may be shared with a household. The
     * original keeps its own; the copy that gets shown and sent does not.
     */
    async derive(from, to, maxEdge) {
      const probe = await ImageManipulator.manipulateAsync(from, [], {
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const longest = Math.max(probe.width, probe.height);
      const actions: ImageManipulator.Action[] = longest > maxEdge
        ? [probe.width >= probe.height ? { resize: { width: maxEdge } } : { resize: { height: maxEdge } }]
        : [];

      const result = await ImageManipulator.manipulateAsync(from, actions, {
        compress: 0.82,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      await FileSystem.deleteAsync(to, { idempotent: true });
      await FileSystem.moveAsync({ from: result.uri, to });
      // The probe's temporary file is the manipulator's, not ours.
      await FileSystem.deleteAsync(probe.uri, { idempotent: true }).catch(() => {});
      return { width: result.width, height: result.height };
    },
  };
}
