# Physical-device test checklist

For the next EAS device build. Grouped by what the simulator **cannot** stand
in for, because those are the ones worth your time — everything else in this
milestone was already verified on the simulator and is listed at the end only
so you know what not to re-check.

Each item says what to do and what counts as a pass. Where something is
expected to *fail*, that is stated: a silent timer with the ringer off is the
correct outcome, not a bug.

## 1. Timers and notifications — the real reason for a device build

The simulator shares the Mac's audio path and does not model the ringer
switch, Focus, Low Power Mode or a real power cycle.

| # | Test | Pass |
| --- | --- | --- |
| 1 | Start a timer, lock the phone, wait for it | Notification wakes the screen and shows on the lock screen |
| 2 | Start a timer, switch to another app | Banner arrives over that app |
| 3 | Ringer switch **off**, start a short timer | Banner arrives, **no sound** — this is correct, not a fault |
| 4 | Focus / Do Not Disturb on | Same: delivered, silent |
| 5 | Force-quit RecipeBox from the app switcher, wait past the deadline | Notification still arrives; the OS holds the schedule, not us |
| 6 | Power the phone **off** across a deadline, then on | Notification arrives late, and the app shows the timer correctly finished — the deadline is stored, so the app never depended on the alert |
| 7 | Three timers finishing within a minute of each other | All three arrive |
| 8 | Low Power Mode on | Delivery is not noticeably deferred |
| 9 | Revoke notification permission in iOS Settings while a timer runs | Timer keeps running; Settings → Timer alerts reads "Not allowed" and offers Open Settings |
| 10 | **Each bundled sound plays**, ringer on: Chime, Bell, Ring, System default | All four audible and distinct. A sound missing from the bundle is indistinguishable from a silent delivery at runtime, which is why this is a device test |
| 11 | Pick Silent, start a timer | Banner, no sound — distinct from System default |
| 12 | Change the sound while a timer is running | The running timer finishes with its **original** sound; the next one uses the new choice |

## 2. Gestures — real fingers, not synthetic drags

A simulated swipe is a clean straight line at constant speed. A thumb is not.

| # | Test | Pass |
| --- | --- | --- |
| 13 | Cook Mode: swipe left and right across several steps | Steps advance and go back; no step skipped |
| 14 | Cook Mode: scroll a long step up and down, repeatedly, briskly | Never dismisses, never changes step |
| 15 | Cook Mode: from the top, pull down and release | Dismisses; the rubber band shows it coming |
| 16 | Cook Mode: pull down a little and let go | Does **not** dismiss |
| 17 | Reopen that recipe | Still on the step you left |
| 18 | Recipe Detail: swipe back from the left edge | Returns to the library |
| 19 | Add button, one-handed, thumb | Reachable and hittable without shifting grip |

## 3. Everything else

| # | Test | Pass |
| --- | --- | --- |
| 20 | Dynamic Type at your own setting, all five tabs | Nothing clipped, nothing overlapping |
| 21 | Dark mode in a dim kitchen | Readable at arm's length; Cook Mode especially |
| 22 | Settings → measurement default, then open a recipe you have never adjusted | Opens in that system where a conversion is possible, and in the recipe's own units where it is not |
| 23 | Open a recipe you *have* adjusted | Keeps what you chose — a per-recipe choice outranks the default |
| 24 | Edit a recipe's tags, force-quit, reopen | Tags still there |
| 25 | Cook something for real, start to finish | The actual test. Whether the step text is readable with wet hands, whether the timer fires when it should, whether anything is in the wrong place |

## Already verified on the simulator — do not spend device time on these

Scaling and conversion arithmetic (155 automated tests), SQLite persistence
across a full force-quit and cold boot, the permission prompt on first timer
start, timer settlement from a stored deadline after hours of elapsed time,
light and dark rendering, accessibility text sizes across every screen, the
empty-library state, and tag/category filtering by meaning.

## What to report back

Anything in column "Pass" that did not. For a gesture, how it failed matters
more than that it failed — "it dismissed while I was scrolling" and "it did
nothing" have different causes and different fixes.
