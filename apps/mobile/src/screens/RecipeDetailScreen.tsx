// Milestone 1: reachable and themed. The real detail screen lands in M5.
import { Placeholder } from "../components/Placeholder";

export function RecipeDetailScreen() {
  return (
    <Placeholder
      title="Recipe"
      summary="One ingredient list, with steps that point at it rather than repeating quantities (ADR 0012)."
      planned={[
        "Ingredients grouped by section",
        "Steps that show the portion each one uses",
        "Source attribution (ADR 0020)",
        "Start Cook Mode",
      ]}
    />
  );
}
