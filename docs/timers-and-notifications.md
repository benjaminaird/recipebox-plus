# Timers and notifications

What RecipeBox's kitchen timers do, what the operating system will and will
not guarantee, and which of those claims a simulator can actually check.

## The design, in one line

**A running timer is an absolute deadline, not a countdown.**

A JavaScript interval stops when the app is backgrounded or the screen locks.
A timer built on "subtract a second each tick" therefore runs slow whenever the
phone is doing anything else — the cook returns to find it says four minutes
left when the dish burned two minutes ago. Storing `endsAt` as an epoch
millisecond makes elapsed time a subtraction against the system clock, so being
asleep, backgrounded or force-quit costs nothing.

Everything else follows from that:

- The countdown on screen is derived, never stored. The one-second interval
  advances `now`; removing it would cost the animation and nothing else.
- A timer whose deadline passed while the app was closed is settled to
  `done` on the next launch, rather than appearing to still be running.
- SQLite is the source of truth. The OS notification is a courtesy on top.

## What a local notification can and cannot promise

| | |
| --- | --- |
| **Will** fire at an absolute time with the app backgrounded or the screen locked | the OS holds the schedule, not us |
| **Will** show while the app is in the foreground | we set a notification handler; without it, a timer going off while the cook is reading the recipe produces nothing |
| **Will not** guarantee a sound | see below |
| **Will not** fire while the device is powered off | it is delivered late, at next boot |
| **Will not** survive the user revoking permission | the timer still runs; only the alert is lost |

### Sound is the OS's decision, not ours

On **iOS**, the ringer switch, Focus modes and per-app notification settings all
suppress notification sound, and an ordinary notification cannot override any of
them. The mechanism that can — a *critical alert* — requires an entitlement
Apple grants case by case for health and safety software. A kitchen timer does
not qualify, and we should not apply.

On **Android**, a Do Not Disturb policy does the same, and sound requires a
notification channel created before the first notification is posted
(`ensureAndroidChannel`). A channel's importance can also be lowered by the
user after creation, and the app cannot raise it back.

**The interface therefore never promises a sound.** `soundCaveat()` returns the
platform's actual caveat and the timer sheet shows it. This is a correctness
requirement, not a disclaimer: a cook who believes the phone will shout at them
behaves differently from one who knows it might not.

## Permission

Asked on first timer start, not at launch — the question is meaningless before
the cook has done anything. On iOS the system prompt appears **once**; after a
denial the only route is Settings, so a denied state must say so rather than
re-asking to no effect.

## What the simulator can verify

Verified on the iOS simulator:

- Scheduling and delivery of a local notification at a deadline.
- Delivery with the app backgrounded.
- Foreground presentation (banner while the app is open).
- Permission prompt, grant and denial paths.
- Timer state surviving a force-quit and a full simulator reboot — this is a
  SQLite property and needs no notification at all.

## What only a physical device can verify

These must be checked on the iPhone before the milestone is called done. The
simulator either does not model them or models them inaccurately:

1. **Ringer switch off** — notification arrives silently, banner still shows.
2. **Focus / Do Not Disturb on** — same.
3. **Device locked** — notification wakes the screen and shows on the lock
   screen.
4. **App force-quit from the app switcher**, then the deadline passes —
   the notification still arrives, because the OS holds the schedule.
5. **Device powered off** across the deadline, then powered on — the
   notification arrives late. Confirm the app's own timer state is still
   correct, since that comes from the stored deadline rather than the alert.
6. **Several timers at once**, finishing close together — each arrives.
7. **Low Power Mode** — confirm delivery is not deferred noticeably.
8. **Notification permission revoked in Settings while timers run** — the
   timers keep running and the app says alerts are off.

## Known limitations we are not fixing

- **No live activity or Dynamic Island presence.** A running timer is not
  visible outside the app except at its deadline. That needs an ActivityKit
  widget, which is a separate piece of native work.
- **No custom sound yet.** The timer-sound setting is part of the Settings
  milestone; until it ships, timers use the system default.
- **No background re-scheduling.** If the OS drops a scheduled notification,
  the app only notices at next launch, when it settles the timer correctly.
