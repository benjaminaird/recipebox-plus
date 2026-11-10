// Milestone 1: reachable and themed. The real dashboard lands in M7.
import { Placeholder } from "../components/Placeholder";

export function HomeScreen() {
  return (
    <Placeholder
      brand
      title="Home"
      summary="The dashboard that opens the app: what you cooked recently, what is planned, and anything waiting to be finished."
      planned={[
        "Recently added and recently cooked recipes",
        "What is planned for today and tomorrow",
        "A cooking session you left part-way through",
        "Import drafts still waiting for review",
      ]}
    />
  );
}
