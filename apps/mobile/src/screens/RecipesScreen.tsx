// Milestone 1: reachable and themed. The real library lands in M4.
import { Placeholder } from "../components/Placeholder";

export function RecipesScreen() {
  return (
    <Placeholder
      title="Recipes"
      summary="Your library, read from the device's own database so it works with no connection."
      planned={[
        "Search across titles, ingredients and tags",
        "Most recently added first",
        "Filter by category and tag",
        "Typographic tiles for recipes with no photo",
      ]}
    />
  );
}
