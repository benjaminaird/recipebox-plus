// A recipe's photograph where there is one, and a recipe card where there is
// not.
//
// One component so the two cases are the same size, the same corner and the
// same place in every list. They were not going to be otherwise: a photograph
// added later would have arrived at whatever dimensions each screen happened
// to pass, and the library would have gone ragged the first time somebody
// imported a recipe with an image.
//
// `resizeMode="cover"` rather than "contain": a recipe photograph is a
// photograph of food, and the subject is in the middle. Letterboxing it into
// a square to preserve every edge wastes the space and makes a list of mixed
// aspect ratios look broken.

import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { parseImageReference } from "../media/reference";
import { fileToShow } from "../media/store";
import { expoMediaFiles } from "../media/expoFiles";
import { RecipeTile } from "./RecipeTile";

export function RecipeThumb({
  title, category, uri, size = 88,
}: {
  title: string;
  category?: string;
  /** The recipe's photograph. Absent, empty or unloadable falls back. */
  uri?: string;
  size?: number;
}) {
  const t = useTheme();
  // A URL that 404s, a file that was evicted, a host that cannot be reached:
  // all of them end here, and all of them mean the same thing to a cook, which
  // is that there is no picture. Falling back is better than a broken frame.
  const [failed, setFailed] = useState(false);
  const [resolved, setResolved] = useState<string | null>(null);

  const reference = parseImageReference(uri);

  // A photograph this app holds is found by id, not by a stored path: iOS
  // rewrites the container path on reinstall, so yesterday's absolute path
  // is today's missing file.
  useEffect(() => {
    if (reference.kind !== "local") { setResolved(null); return; }
    let live = true;
    fileToShow(expoMediaFiles(), reference.mediaId, size > 160 ? "display" : "thumb")
      .then((path) => { if (live) setResolved(path); })
      .catch(() => { if (live) setResolved(null); });
    return () => { live = false; };
  }, [reference.kind, reference.kind === "local" ? reference.mediaId : "", size]);

  // Only references this app understands reach the image loader.
  //
  // `heroImage` is not ours: it arrives from a web page the cook imported and
  // from the account's sync feed, and an <Image> will dutifully fetch
  // whatever it is handed. A file:// would read this device's own files into
  // a view; an http:// to a private address is a request made from inside the
  // cook's network; either is a beacon that fires the moment a list scrolls
  // past. So: https for a publisher's image, this app's own store for a
  // photograph it holds, and nothing else — a recipe with no picture has a
  // perfectly good card.
  const source =
    reference.kind === "remote" && /^https:\/\//i.test(reference.url) ? reference.url
    : reference.kind === "local" ? resolved
    : null;

  if (!source || failed) return <RecipeTile title={title} category={category} size={size} />;

  return (
    <View
      style={[
        styles.frame,
        { width: size, height: size, borderRadius: t.radius.sm, backgroundColor: t.colors.tileGround },
      ]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Image
        source={{ uri: source }}
        style={{ width: size, height: size }}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden" },
});
