// Milestone 1: reachable and themed. The real Cook Mode lands in M6.
import { Placeholder } from "../components/Placeholder";

export function CookModeScreen() {
  return (
    <Placeholder
      title="Cook Mode"
      summary="One step at a time, with the ingredients that step needs and your place kept if you put the phone down."
      planned={[
        "Step-by-step navigation",
        "The right quantity for the step you are on",
        "Progress saved across restarts",
        "Timers and background alerts (staged separately)",
      ]}
    />
  );
}
