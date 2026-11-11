// The centred Add button.
//
// Not a tab. Add is an action, not a place: there is nothing to come back to
// and nothing to leave behind, so pressing it opens import-or-create over
// whatever the cook was doing and returns them there afterwards. It keeps the
// middle slot because that is where a thumb lands and because the five-slot
// rhythm is what makes the bar read as a bar -- but the press is intercepted
// and the route beneath it is never actually focused.
//
// It is also the only accent-coloured thing in the bar, which is the point:
// everything else in RecipeBox is reading, and this is the one place where
// something new comes in.
import { Platform, Pressable, StyleSheet, View } from "react-native";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeProvider";

/** How far the circle rises above the bar's top edge. Enough to read as
 *  raised, not so much that it floats free of the bar it belongs to. */
export const ADD_LIFT = 14;
const DIAMETER = 54;

export function AddTabButton({ onPress, accessibilityState }: BottomTabBarButtonProps) {
  const t = useTheme();
  const c = t.colors;

  return (
    <View style={styles.slot} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Add a recipe"
        accessibilityHint="Opens import or create"
        // Never "selected": the route behind this button is not somewhere the
        // cook can be, so announcing it as the current tab would be a lie.
        accessibilityState={{ ...accessibilityState, selected: false }}
        hitSlop={8}
        style={({ pressed }) => [
          styles.button,
          {
            width: DIAMETER,
            height: DIAMETER,
            borderRadius: DIAMETER / 2,
            marginTop: -ADD_LIFT,
            backgroundColor: c.accent,
            // A ring in the canvas colour separates the circle from the bar's
            // top border where they overlap, so the lift reads as depth
            // rather than as a button that has slipped out of alignment.
            borderWidth: 3,
            borderColor: c.canvas,
            transform: [{ scale: pressed ? 0.94 : 1 }],
          },
          Platform.OS === "ios" ? styles.shadowIOS : styles.shadowAndroid,
        ]}
      >
        <Ionicons name="add" size={30} color={c.onAccent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1, alignItems: "center", justifyContent: "flex-start" },
  button: { alignItems: "center", justifyContent: "center" },
  shadowIOS: {
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  shadowAndroid: { elevation: 6 },
});
