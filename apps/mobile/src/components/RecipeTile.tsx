// The stand-in for a recipe with no photograph (ADR 0018): a typographic tile
// carrying the title's initial and the category.
//
// The category is held to a single line and truncated. A long one such as
// "Baked Goods" wrapped in the earlier design-check screen, which read as a
// bug rather than a choice; the label also opts out of Dynamic Type, as the
// tile is a fixed-size graphic element and growing the text inside it only
// breaks the composition. The screen's own text scales normally.
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { textStyle } from "../theme/fonts";

export function RecipeTile({ title, category, size = 88 }: { title: string; category?: string; size?: number }) {
  const t = useTheme();
  const c = t.colors;
  const initial = title.trim().charAt(0).toUpperCase() || "?";

  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, backgroundColor: c.tileGround, borderRadius: t.radius.sm },
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
      {category ? (
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[textStyle("eyebrow"), { color: c.tileInk, letterSpacing: 0.4 }]}
        >
          {category}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { padding: 10, justifyContent: "space-between", overflow: "hidden" },
});
