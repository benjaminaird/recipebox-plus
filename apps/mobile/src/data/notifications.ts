// Local notifications for timers.
//
// What this can and cannot promise, stated here because the interface has to
// repeat it honestly rather than imply a guarantee the OS does not give:
//
//   It CAN   deliver a notification at an absolute time while the app is
//            backgrounded or the screen is locked, because the OS holds the
//            schedule, not us.
//
//   It CANNOT guarantee a sound. On iOS the ringer switch, Focus modes and
//            per-app notification settings all suppress it, and a notification
//            cannot override any of them -- a critical alert needs an
//            entitlement Apple grants case by case, and a kitchen timer does
//            not qualify. On Android a Do Not Disturb policy does the same.
//
//   It CANNOT fire at all if the device is powered off at the deadline. The
//            notification is delivered when it next boots, late.
//
//   It CANNOT be relied on while the app is being killed repeatedly by the
//            OS; the schedule survives, but our own bookkeeping only catches
//            up on next launch.
//
// The timers themselves do not depend on any of this. A deadline is absolute
// and stored, so the app always shows the correct remaining time when opened,
// whether or not a notification was delivered. The notification is a courtesy
// on top, never the source of truth.
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export type PermissionState = "granted" | "denied" | "undetermined";

let configured = false;

/** Show an alert even when the app is in the foreground; without this a timer
 *  going off while the cook is looking at the recipe produces nothing. */
export function configureNotifications(): void {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function getPermission(): Promise<PermissionState> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status as PermissionState;
  } catch {
    return "undetermined";
  }
}

/**
 * Ask, once. iOS only shows the system prompt the first time; afterwards the
 * only route is Settings, so the caller must handle "denied" by telling the
 * cook where to go rather than asking again to no effect.
 */
export async function requestPermission(): Promise<PermissionState> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status as PermissionState;
  } catch {
    return "denied";
  }
}

export type ScheduleOptions = {
  id: string;
  title: string;
  body: string;
  /** Absolute epoch ms. A deadline in the past is not scheduled. */
  endsAt: number;
  /** A bundled sound file name, or null for the system default. */
  sound?: string | null;
};

/**
 * Schedule one timer's notification, replacing any already scheduled for it.
 *
 * Returns the OS identifier, or null when nothing was scheduled -- a deadline
 * already past, or permission not granted. Callers must treat null as normal
 * rather than as an error: the timer still works.
 */
export async function scheduleTimerNotification(
  { id, title, body, endsAt, sound }: ScheduleOptions,
): Promise<string | null> {
  const seconds = Math.round((endsAt - Date.now()) / 1000);
  if (seconds <= 0) return null;

  await cancelTimerNotification(id);
  try {
    return await Notifications.scheduleNotificationAsync({
      identifier: `timer-${id}`,
      content: {
        title,
        body,
        sound: sound ?? "default",
        // Android needs a channel for sound; iOS ignores this field.
        ...(Platform.OS === "android" ? { channelId: "timers" } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
      },
    });
  } catch {
    return null;
  }
}

export async function cancelTimerNotification(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(`timer-${id}`);
  } catch {
    // Cancelling something that was never scheduled is not a failure.
  }
}

/** Android requires a channel before any sound plays. Harmless on iOS. */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("timers", {
      name: "Kitchen timers",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 300, 200, 300],
      enableVibrate: true,
    });
  } catch {
    // A failed channel costs the sound, not the timer.
  }
}

/** What the interface may truthfully say about alerts on this platform. */
export function soundCaveat(): string {
  return Platform.OS === "ios"
    ? "Alerts follow your ringer switch and Focus settings, so a timer may arrive silently."
    : "Alerts follow your Do Not Disturb settings, so a timer may arrive silently.";
}
