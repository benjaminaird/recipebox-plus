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

---

# The networked journey, on a real phone

Added for the device-test build of 13 November 2026, which is the first one
pointed at a backend the phone can actually reach. Everything below was
verified on the simulator; the point of repeating it here is that the
simulator shares the Mac's network stack and its Keychain, so none of it was
ever tested across a real network boundary or a real Secure Enclave.

## Before you start

Four things must be running on the Mac, and the phone needs the first of them
reachable:

| What | How to check |
| --- | --- |
| Tailscale, on both devices | The iPhone's Tailscale app shows Connected |
| The PostgreSQL container | `docker ps` lists `rb-tx-test` |
| The backend on port 3100 | `curl -s localhost:3100/api/health` → `{"status":"ok","database":true}` |
| The Serve rule | `tailscale serve status` lists `:8443 → 127.0.0.1:3100` |

If the phone cannot reach the server, every test below fails the same way and
tells you nothing. Check this first, in Safari on the phone:

    https://macbook-pro.taila46925.ts.net:8443/api/health

Test account credentials are in `apps/mobile/.env.device-test.local`, which is
git-ignored. Both accounts live only in the throwaway container.

**If you close the Mac's lid, stop the container, or quit Tailscale, the app
does not break — it goes offline.** That is itself worth testing, and is test
4.3 below.

## 1. Sign-in, on a real Secure Enclave

The simulator's Keychain is a file on the Mac. This is the first test of the
real one.

| # | Test | Pass |
| --- | --- | --- |
| 1.1 | Sign in as account A | Account screen shows the name, the email, and "Confirmed" against the email address |
| 1.2 | Force-quit from the app switcher, reopen | Still signed in, with no password prompt — the credential came back from the Keychain |
| 1.3 | Power the phone off and on, open the app before unlocking anything else | Still signed in. This is the one the simulator cannot test: the key is protected until first unlock |
| 1.4 | Sign in with the right email and a wrong password | "Email or password did not match", and the password field clears |
| 1.5 | **Delete the app, reinstall it, open it** | Signed **out**. The iOS Keychain outlives app deletion, so a credential surviving here would be a defect — the app detects the fresh install and drops it |

## 2. Recipe synchronisation

Download is one-way by design: it copies the cloud into the phone and uploads
nothing. There is no upload endpoint to call.

| # | Test | Pass |
| --- | --- | --- |
| 2.1 | Settings → Manage → Download | "Up to date — 3 new", and the three appear in the library |
| 2.2 | Tap Download again | "Up to date — nothing new" — no duplicates, no second copy |
| 2.3 | Open a downloaded recipe | Amounts, sections and source attribution all intact |
| 2.4 | Edit a downloaded recipe on the phone, then Download again | Your edit survives; the pull does not overwrite it |
| 2.5 | Write a recipe on the phone, then Download | The new recipe is untouched and stays local — nothing you made here is sent anywhere |
| 2.6 | Turn Tailscale off on the phone, tap Download | "No connection. Nothing was downloaded, and nothing was lost." in **amber**, not green. A failure that reads as a success is the defect this wording was written against |

## 3. Importing from a link

| # | Test | Pass |
| --- | --- | --- |
| 3.1 | Share a recipe from Safari, or paste `https://www.bbcgoodfood.com/recipes/classic-scones-jam-clotted-cream` | Review screen shows "Classic scones with jam & clotted cream", 9 ingredients, 6 steps |
| 3.2 | Check the amounts column | `350 g`, `1 tsp`, `85 g`, `3 tbsp`, `175 ml`, `1 tsp` — the three garnish lines show `—`, and only those three are flagged "Worth a look" |
| 3.3 | Save it, then look at the library | Saved, and it stays on the phone: importing uploads nothing |
| 3.4 | Import a page that is not a recipe | A message naming something you can do next, not "failed" |
| 3.5 | Import a site that blocks us, e.g. seriouseats.com | "nothing is wrong with the link", and it offers pasting instead |
| 3.6 | Turn Tailscale off, try an import | "No connection", and it says your recipes still work |

## 4. Cooking, offline, in a kitchen

| # | Test | Pass |
| --- | --- | --- |
| 4.1 | Open a recipe, Start Cook Mode, walk through all steps | Step counter and progress bar track; ingredient shares show per step |
| 4.2 | In Cook Mode, let the screen idle | It stays awake — this cannot be tested on a simulator |
| 4.3 | **Turn Tailscale off, or close the Mac's lid.** Open a recipe and cook it | Everything works. The library is on the phone; the server is only for sync and import |
| 4.4 | Still offline, force-quit and reopen mid-cook | It resumes at the step you were on, at the scale you set |
| 4.5 | Reconnect | No error, no re-sync demanded, nothing lost |

## 5. Scaling and measurements

The conversion work landed on 13 November; these are the cases it was written
for.

| # | Test | Pass |
| --- | --- | --- |
| 5.1 | A recipe with a kilo or more of flour, at 2× | Reads in **pounds**, not "19.3 cups" |
| 5.2 | A metric recipe, switch to US | Stock and milk stay volumes; flour and sugar become cups |
| 5.3 | Anything converted through an ingredient's density | Marked `~`, with one line at the foot of the list explaining the mark |
| 5.4 | An exact conversion, e.g. 500 ml → cups | **No** `~`. The mark means "this rests on what a cup of flour weighs", and must not appear on arithmetic |
| 5.5 | Switch to Original | Exactly what the source wrote, unchanged, at any scale |
| 5.6 | Scale to 4×, then back to 1× | The original numbers return exactly — scaling never edits the recipe |

## 6. Shopping lists

| # | Test | Pass |
| --- | --- | --- |
| 6.1 | Add a recipe to a new list at 2× | Every amount doubled; the list says which recipe each item came from |
| 6.2 | Add a second recipe sharing an ingredient | The two combine into one line where the units allow it |
| 6.3 | A recipe in grams and another in cups | They do **not** combine into a mixed figure — two lines is the correct answer |
| 6.4 | Tick items off, force-quit, reopen | Ticks survive |
| 6.5 | Offline | Lists work fully; they never needed the server |

## 7. Account isolation on one phone

This is the one that was broken until 13 November, and the one most worth
your attention. Two accounts on a shared phone must not see each other.

| # | Test | Pass |
| --- | --- | --- |
| 7.1 | Signed in as A, note the library and download A's recipes | Library holds A's recipes |
| 7.2 | Sign out | Recipes **stay** on the phone. Signing out is not a request to delete anyone's cookbook |
| 7.3 | Sign in as account B | Library is B's, seeded fresh. **None of A's recipes are visible** — not in Home, not in Recipes, not in search |
| 7.4 | Account screen as B | Shows "A separate library on this device". That notice used to be a lie; check it is now true by 7.3 |
| 7.5 | Download as B | B's recipes arrive; A's library is not touched |
| 7.6 | Sign out of B, sign back in as A | A's library comes back exactly as it was in 7.1, including anything downloaded |
| 7.7 | Watch the library as the app opens, signed in as B | It must **never** flash A's recipes first. The app now waits for the right library rather than opening the wrong one |

## What not to re-check

Verified on the simulator on 13 November and not worth your time again unless
something here looks wrong: the nine-step journey end to end, 349 unit tests,
the conversion and presentation rules, pull-only sync against PostgreSQL, and
the import review screen's wording.

Timers and notifications are in the first half of this document and are still
the other reason a device build exists.
