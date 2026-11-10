// The serif is bundled (Newsreader, SIL Open Font License); the sans is the
// platform system font and is never bundled, so it keeps Dynamic Type and font
// scale metrics (ADR 0019). Only the four faces the spec uses are loaded.
import { Newsreader_300Light } from "@expo-google-fonts/newsreader/300Light";
import { Newsreader_400Regular } from "@expo-google-fonts/newsreader/400Regular";
import { Newsreader_400Regular_Italic } from "@expo-google-fonts/newsreader/400Regular_Italic";
import { Newsreader_500Medium } from "@expo-google-fonts/newsreader/500Medium";
import type { TextStyle } from "react-native";
import { typography } from "./tokens.generated";

export const serifFonts = {
  Newsreader_300Light,
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium,
};

type Role = keyof typeof typography;

function serifFamily(weight: number, italic: boolean): string {
  if (italic) return "Newsreader_400Regular_Italic";
  if (weight <= 300) return "Newsreader_300Light";
  if (weight >= 500) return "Newsreader_500Medium";
  return "Newsreader_400Regular";
}

/** A Text style for a type role from the token file. Sizes stay unscaled here; the OS scales them. */
export function textStyle(role: Role): TextStyle {
  const r = typography[role] as {
    family: "serif" | "sans"; size: number; lineHeight: number; weight: number;
    style?: string; tracking?: number; transform?: string; fontVariant?: readonly string[];
  };
  const italic = r.style === "italic";
  const style: { -readonly [K in keyof TextStyle]: TextStyle[K] } = { fontSize: r.size, lineHeight: r.lineHeight };
  if (r.family === "serif") style.fontFamily = serifFamily(r.weight, italic);
  else style.fontWeight = String(r.weight) as TextStyle["fontWeight"];
  if (r.tracking) style.letterSpacing = r.tracking;
  if (r.transform === "uppercase") style.textTransform = "uppercase";
  if (r.fontVariant) style.fontVariant = [...r.fontVariant] as TextStyle["fontVariant"];
  return style;
}

/**
 * How far a role may grow under Dynamic Type.
 *
 * Body text scales all the way — that is the point of Dynamic Type, and
 * capping it would be an accessibility regression. Display roles are the
 * exception: they already start large for their own reasons (cookStep is 25pt
 * because it is read at arm's length across a kitchen), and multiplying an
 * already-large size by the top accessibility factor of roughly 3.1 put four
 * words on the screen and pushed the ingredients and the buttons off it.
 *
 * So the big roles still grow, just not without bound. The cap is applied as
 * `maxFontSizeMultiplier`, which the OS respects per Text.
 */
const MAX_SCALE: Partial<Record<Role, number>> = {
  largeTitle: 1.6,
  recipeTitle: 1.6,
  sectionTitle: 1.7,
  preparationTitle: 1.7,
  cookStep: 1.7,
  timer: 1.6,
};

export function maxScale(role: Role): number | undefined {
  return MAX_SCALE[role];
}

/**
 * A type role for a TextInput.
 *
 * Same as textStyle(), minus lineHeight. React Native positions a TextInput's
 * text against an explicit lineHeight rather than growing with it, so at large
 * Dynamic Type sizes the field grows while the text stays pinned near the
 * bottom of the box. Dropping lineHeight lets the input centre its own text.
 */
export function inputStyle(role: Role): TextStyle {
  const { lineHeight, ...rest } = textStyle(role);
  return rest;
}
