// What stands in for a recipe with no photograph.
//
// The old answer was the title's initial, set enormous. It was legible and it
// was wrong: a column of giant letters is an avatar list, not a cookbook, and
// at a glance it says nothing a cook wants to know — the title is already
// beside it, in full, set better.
//
// This one is a recipe card. A hairline across the top where a card has its
// rule, the category beneath it where a card has its heading, and at the foot
// the suggestion of written lines. It is quiet on purpose: the tile is an
// anchor for the eye down a list, not a thing competing with the title for
// attention. Nothing here is decoration that could be removed without the
// tile stopping looking like what it is.
//
// Deliberately NOT varied per recipe beyond the category. Inventing a
// different mark for every recipe is the monogram mistake with better
// manners: it makes the eye work at distinguishing tiles that carry no
// information to distinguish.
//
// Two rules the category label has to obey, both learned from the screen:
//
//   It never wraps. "Baked Goods" wrapped to two lines in the old design-check
//   screen and read as a bug rather than a choice.
//
//   It never truncates to a stub. Held to one line it became "BAK…", "ENT…",
//   "DES…" on the small tile -- noise occupying the space of information. So
//   the label shrinks to fit down to a floor, and below the size where even
//   the floor cannot hold a real word, it is dropped entirely.
//
// The tile opts out of Dynamic Type because it is a fixed-size graphic; text
// growing inside it only breaks the composition. Screen text scales normally,
// and the lists drop the tile altogether at the largest sizes.
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { textStyle } from "../theme/fonts";

/** Below this, the tile carries its rules alone: no label would fit honestly. */
const CATEGORY_MIN_TILE = 80;

/**
 * The written lines, as fractions of the tile's width.
 *
 * They sit directly under the heading rather than at the foot. Bottom-
 * anchoring them left a hole in the middle of every tile — worst on a recipe
 * with no category, where the tile was a rule, a void, and three faint marks,
 * and read as unfinished rather than as quiet. A card's lines start where its
 * heading ends; the margin belongs at the bottom.
 *
 * The last one is short because the last line of anything written is.
 */
const LINES = [1, 1, 0.82, 0.44];

export function RecipeTile({ title, category, size = 88 }: { title: string; category?: string; size?: number }) {
  const t = useTheme();
  const c = t.colors;
  const showCategory = Boolean(category) && size >= CATEGORY_MIN_TILE;
  const pad = Math.round(size * 0.14);
  const inner = size - pad * 2;

  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          backgroundColor: c.tileGround,
          borderRadius: t.radius.sm,
          padding: pad,
        },
      ]}
      // The title is read out beside it; a tile that also announced the
      // initial would make every row say the first letter twice.
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {/* The card's own rule, where a printed one has its heading. */}
      <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: c.tileInk, opacity: 0.55 }} />

      {showCategory ? (
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          style={[textStyle("eyebrow"), { color: c.tileInk, letterSpacing: 0.3, marginTop: Math.round(size * 0.075) }]}
        >
          {category}
        </Text>
      ) : null}

      {/* The body of the card. */}
      <View style={{ marginTop: Math.round(size * 0.075), gap: Math.max(4, Math.round(size * 0.075)) }}>
        {LINES.map((fraction, index) => (
          <View
            key={index}
            style={{
              width: inner * fraction,
              height: StyleSheet.hairlineWidth * 2,
              backgroundColor: c.tileInk,
              // Faint enough to stay behind the title beside it, strong
              // enough to read as drawn rather than as a rendering fault.
              opacity: 0.38,
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: "hidden" },
});
