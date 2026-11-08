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
