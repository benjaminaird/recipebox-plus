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

import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
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
  const source = (uri ?? "").trim();

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
