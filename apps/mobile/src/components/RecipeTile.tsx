// The stand-in for a recipe with no photograph (ADR 0018): a typographic tile
// carrying the title's initial and, where there is room, the category.
//
// Two rules the category label has to obey, both learned from the screen:
//
//   It never wraps. "Baked Goods" wrapped to two lines in the old design-check
//   screen and read as a bug rather than a choice.
//
//   It never truncates to a stub. Held to one line it became "BAK…", "ENT…",
//   "DES…" on the small tile -- noise occupying the space of information. So
//   the label shrinks to fit down to a floor, and below the size where even
//   the floor cannot hold a real word, it is dropped entirely. An initial and
//   a clean tile say more than three letters and an ellipsis.
//
// The tile opts out of Dynamic Type because it is a fixed-size graphic; text
// growing inside it only breaks the composition. Screen text scales normally.
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { textStyle } from "../theme/fonts";

/** Below this, the tile carries the initial alone. */
const CATEGORY_MIN_TILE = 80;

export function RecipeTile({ title, category, size = 88 }: { title: string; category?: string; size?: number }) {
  const t = useTheme();
  const c = t.colors;
  const initial = title.trim().charAt(0).toUpperCase() || "?";
  const showCategory = Boolean(category) && size >= CATEGORY_MIN_TILE;

  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          backgroundColor: c.tileGround,
          borderRadius: t.radius.sm,
          padding: Math.round(size * 0.11),
          justifyContent: showCategory ? "space-between" : "center",
          alignItems: showCategory ? "flex-start" : "center",
        },
      ]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: "Newsreader_300Light",
          fontSize: size * 0.5,
          lineHeight: size * 0.52,
          color: c.tileInk,
        }}
      >
        {initial}
      </Text>
      {showCategory ? (
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          style={[textStyle("eyebrow"), { color: c.tileInk, letterSpacing: 0.3 }]}
        >
          {category}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: "hidden" },
});
