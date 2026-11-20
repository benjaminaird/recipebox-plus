// Taking and choosing a photograph.
//
// The thin layer over expo-image-picker, and the one place that knows what a
// refused permission means. Everything about what happens to the bytes
// afterwards is in store.ts; this is only how they arrive.
//
// Permissions are requested at the moment of use, never at launch. A cook who
// opens a cookbook has not asked to be interrogated about their camera, and a
// prompt with no context attached is the one people deny — after which iOS
// never asks again and the feature is gone for good. Asked when they tap "Take
// a photo", the prompt explains itself.

import * as ImagePicker from "expo-image-picker";

export type PhotoOutcome =
  | { status: "picked"; uri: string; width: number; height: number }
  /** They changed their mind. Not an error, and not worth a message. */
  | { status: "cancelled" }
  /** Refused, and iOS will not ask again: Settings is the only way back. */
  | { status: "denied"; what: "camera" | "library" }
  | { status: "failed"; message: string };

/**
 * Full quality, deliberately.
 *
 * `quality: 1` and no `allowsEditing`. The picker will happily hand back a
 * re-encoded, cropped, downscaled image, and that would be the only copy this
 * app ever sees — exactly the mistake ADR 0008 records about the web import,
 * which downscaled at import time and lost the detail before storage. The
 * derivative is made later, from the original, and the original keeps
 * everything it arrived with.
 */
const OPTIONS: ImagePicker.ImagePickerOptions = {
  quality: 1,
  allowsEditing: false,
  exif: false,
  mediaTypes: ["images"],
};

function fromResult(result: ImagePicker.ImagePickerResult): PhotoOutcome {
  if (result.canceled) return { status: "cancelled" };
  const asset = result.assets?.[0];
  if (!asset?.uri) return { status: "failed", message: "That photo could not be read." };
  return {
    status: "picked",
    uri: asset.uri,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
  };
}

export async function takePhoto(): Promise<PhotoOutcome> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { status: "denied", what: "camera" };
    return fromResult(await ImagePicker.launchCameraAsync(OPTIONS));
  } catch (err) {
    return { status: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function choosePhoto(): Promise<PhotoOutcome> {
  try {
    // iOS 14+ can grant access to a chosen few photos rather than all of
    // them, and that counts as granted: the picker shows what was allowed.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { status: "denied", what: "library" };
    return fromResult(await ImagePicker.launchImageLibraryAsync(OPTIONS));
  } catch (err) {
    return { status: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}

/** What to tell somebody whose answer iOS has remembered. */
export function deniedMessage(what: "camera" | "library"): { title: string; detail: string } {
  return what === "camera"
    ? {
        title: "RecipeBox cannot use the camera",
        detail: "Camera access is off for RecipeBox. You can turn it on in Settings, or choose a photo you have already taken.",
      }
    : {
        title: "RecipeBox cannot see your photos",
        detail: "Photo access is off for RecipeBox. You can turn it on in Settings, or take a new photo instead.",
      };
}
