#!/usr/bin/env bash
#
# Build RecipeBox, install it on a simulator, and report honestly whether it
# actually started.
#
# Three failures this script exists to prevent, each of which cost real time:
#
#   1. CocoaPods aborting with
#        Unicode Normalization not appropriate for ASCII-8BIT
#      `expo run:ios` shells out to `pod install` itself, and CocoaPods calls
#      String#unicode_normalize on the project path. Under a non-UTF-8 locale
#      that raises. Setting the locale by hand in one terminal is not a fix;
#      it has to travel with the command, which is why it is set here.
#
#   2. A build reported as succeeding when it had not. `xcodebuild ... | tail`
#      exits with tail's status, so error code 65 arrives as 0. Everything
#      below runs under `set -o pipefail` and checks PIPESTATUS explicitly.
#
#   3. "The simulator is showing a home screen, so it launched." It did not.
#      A screenshot proves nothing on its own: the simulator may be showing
#      springboard, a different app entirely, or RecipeBox's splash while the
#      JS bundle fails to load. This checks the process is alive by PID some
#      seconds AFTER launch, so an immediate crash is caught.
#
# Usage: scripts/run-ios-sim.sh ["iPhone 17 Pro"]

set -euo pipefail
set -o pipefail

# (1) The locale, applied to every child process including pod install.
export LANG="${LANG_OVERRIDE:-en_US.UTF-8}"
export LC_ALL="${LANG}"

DEVICE="${1:-iPhone 17 Pro}"
BUNDLE_ID="com.benjaminaird.recipebox.dev"
SETTLE_SECONDS="${SETTLE_SECONDS:-8}"

cd "$(dirname "$0")/.."
LOG_DIR="${TMPDIR:-/tmp}/recipebox-ios"
mkdir -p "$LOG_DIR"
BUILD_LOG="$LOG_DIR/build-$(date +%Y%m%d-%H%M%S).log"

echo "==> Locale  : LANG=$LANG LC_ALL=$LC_ALL"
echo "==> Device  : $DEVICE"
echo "==> Build log: $BUILD_LOG"

# (2) tee for a readable log, PIPESTATUS for the truth about the exit status.
set +e
npx expo run:ios --device "$DEVICE" 2>&1 | tee "$BUILD_LOG"
STATUS="${PIPESTATUS[0]}"
set -e

if [ "$STATUS" -ne 0 ]; then
  echo
  echo "FAILED: expo run:ios exited $STATUS (this is expo's status, not tee's)."
  echo "Last lines of $BUILD_LOG:"
  tail -40 "$BUILD_LOG"
  if grep -q "Unicode Normalization not appropriate" "$BUILD_LOG"; then
    echo
    echo "HINT: that is the CocoaPods locale crash. The locale is exported above,"
    echo "      so if it still appears, something is resetting it downstream."
  fi
  exit "$STATUS"
fi

UDID="$(xcrun simctl list devices booted -j \
  | python3 -c 'import json,sys
d=json.load(sys.stdin)["devices"]
print(next((x["udid"] for v in d.values() for x in v if x.get("state")=="Booted"), ""))')"

if [ -z "$UDID" ]; then
  echo "FAILED: the build succeeded but no simulator is booted, so nothing ran."
  exit 1
fi
echo "==> Booted simulator: $UDID"

# (3) Did it actually start, and stay started?
PID="$(xcrun simctl launch "$UDID" "$BUNDLE_ID" 2>/dev/null | awk -F': ' '{print $2}' | tr -d ' ')"
if [ -z "$PID" ]; then
  echo "FAILED: $BUNDLE_ID would not launch on $UDID."
  exit 1
fi
echo "==> Launched $BUNDLE_ID as pid $PID; waiting ${SETTLE_SECONDS}s to see if it stays up"
sleep "$SETTLE_SECONDS"

if ! ps -p "$PID" >/dev/null 2>&1; then
  echo "FAILED: pid $PID is gone ${SETTLE_SECONDS}s after launch -- the app started and died."
  echo "        A screenshot taken now would show the simulator home screen and look fine."
  exit 1
fi

SHOT="$LOG_DIR/launched-$(date +%Y%m%d-%H%M%S).png"
xcrun simctl io "$UDID" screenshot "$SHOT" >/dev/null 2>&1 || true

echo
echo "OK: $BUNDLE_ID (pid $PID) is still running ${SETTLE_SECONDS}s after launch."
echo "    Screenshot: $SHOT"
echo
echo "    What this does NOT prove: that the JS bundle loaded, or that the"
echo "    screen you wanted is on screen. A dev build sitting on the Expo"
echo "    launcher, or stuck on the splash, satisfies every check above."
echo "    Look at the screenshot before calling anything verified."
