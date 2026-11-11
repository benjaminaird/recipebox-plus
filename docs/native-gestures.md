# Gestures in the native client

What is implemented, what was investigated and rejected, and the one finding
that cost the most to get.

## Implemented

| Gesture | Where | What it does |
| --- | --- | --- |
| Swipe left / right | Cook Mode | Next / previous step |
| Pull down past the top | Cook Mode | Leave, keeping the saved place |
| Swipe from the left edge | Recipe Detail, Settings | System back (native stack) |
| Flick down | Add sheet | System modal dismissal |

Every one of these has a visible control beside it. Cook Mode keeps **Next
step** and **Back**; the Add sheet has **Close**; Recipe Detail and Settings
keep the back chevron. A gesture is an accelerator for a cook whose hands are
busy, never the only way to do something — a gesture nobody discovers is a
feature nobody has.

### Leaving Cook Mode is an overscroll, not a pan

This is worth recording because it looked like a bug in our code for an hour
and was not.

A `Gesture.Pan` configured to activate on a downward drag did **nothing**, and
failed silently: it compiled, it mounted, it reported no error. An on-screen
readout of the gesture's own state showed why — the pan received a total
translation of **ten points on a three-hundred-point drag** before being
cancelled. The `ScrollView` underneath claims a vertical drag within a few
points and cancels any pan competing for it, long before the pan can reach its
activation threshold.

Neither remedy in the Gesture Handler documentation changed it:

- `simultaneousWithExternalGesture(scrollRef)` — pan still cancelled.
- `blocksExternalGesture(scrollRef)` — pan still cancelled.

(Both were tried with Gesture Handler's own `ScrollView`, not React Native's,
which is the documented requirement for either relation to apply at all.)

So the scroll view keeps the drag and we read its result instead:
`onScrollEndDrag` with `contentOffset.y < -90`. This is **better** than the pan
would have been, not a workaround:

- An overscroll can only happen at the top of the content. "Prevent accidental
  dismissal while scrolling" stops being a rule we enforce and becomes a
  property of the mechanism — mid-step there is content above and no overscroll
  to give.
- The rubber band is free feedback. The cook watches the step being pulled and
  can let go early if they did not mean it. A pan gives no such preview.

**Android does not have this.** It answers an overscroll with a stretch or a
glow and reports no negative offset. There, Close and the system back gesture
are the way out. Stated rather than papered over; if swipe-down matters on
Android it needs its own mechanism and its own testing.

A `GestureHandlerRootView` is mounted at the app root. Without it a
`GestureDetector` mounts, compiles, and never fires — the same silent-failure
shape as above.

## Investigated and rejected: swiping between the bottom tabs

The brief asked for this to be looked at. It should not be built. Four reasons,
in order of how hard they are to argue with:

**1. The middle slot is not a destination.** Add opens import-or-create over
the current screen; there is no "Add tab" to swipe onto. A left-to-right
sequence of Home → Recipes → Add → Plan → Lists is therefore incoherent: the
swipe would have to either skip the slot — so the gesture and the bar disagree
about what is next to what — or open a modal mid-swipe, which is not something
a drag should ever do.

**2. Recipes is full of horizontal content.** It has two horizontal pill rows
(categories and tags). A screen-wide horizontal pan competes with both, and the
loser is whichever the cook meant.

**3. `@react-navigation/bottom-tabs` does not support it.** v7 offers
`animationEnabled` for the transition and no swipe option at all. Getting it
would mean either moving to `createMaterialTopTabNavigator` — which replaces
the tab bar wholesale, taking the raised Add button with it — or a hand-rolled
pan across every screen, which is reason 2 again, five times over.

**4. It is not the platform's idiom.** Swiping between bottom tabs is a
Material pattern. On iOS the bottom bar is a set of destinations you tap, and
horizontal drags belong to back-navigation. Adding a competing meaning
devalues both.

Cook Mode keeps horizontal swipes because it is a full-screen modal with no
tab bar and no competing horizontal content, and because stepping through a
recipe is exactly the linear sequence a swipe describes.

## Testing

Gestures are verified by performing them on the simulator and looking at what
happened, not by observing that the code compiled. The negative cases matter
as much as the positive ones, and are checked explicitly:

- Scrolling a long step up and down does **not** dismiss Cook Mode.
- A vertical drag does **not** change step.
- Leaving by gesture preserves the step; only **Finish** clears it.

Physical-device checks these cannot stand in for are listed in
[timers-and-notifications.md](./timers-and-notifications.md).
