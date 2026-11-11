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
import {
  TIMER_SOUND_CHOICES, timerChannelId, timerSoundFile, timerSoundIsSilent,
  type TimerSound,
} from "../settings/settings";

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
  /** Which alert to use. The bundle filename and Android channel are derived
   *  from it, so a caller never has to know either. */
  sound?: TimerSound;
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
        // iOS takes the bundled filename directly; "default" is the system
        // sound. On Android the filename is ignored and the channel decides,
        // which is why there is a channel per sound.
        sound: soundValue(sound),
        ...(Platform.OS === "android" ? { channelId: timerChannelId(sound ?? "chime") } : {}),
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

/** The value iOS wants: a bundled filename, the system sound, or `false` for a
 *  banner with no sound. */
function soundValue(sound: TimerSound | undefined): string | false {
  const choice = sound ?? "chime";
  if (timerSoundIsSilent(choice)) return false;
  return timerSoundFile(choice) ?? "default";
}

/**
 * Android requires a channel before any sound plays, and a channel's sound is
 * fixed when it is created -- Android will not let an app change it afterwards,
 * so that a choice made in system settings sticks. Offering a choice therefore
 * means one channel per sound, created up front. Harmless on iOS.
 */
export async function ensureTimerChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  for (const choice of TIMER_SOUND_CHOICES) {
    try {
      await Notifications.setNotificationChannelAsync(timerChannelId(choice.value), {
        name: `Kitchen timers (${choice.label})`,
        importance: Notifications.AndroidImportance.HIGH,
        // null is a silent channel; "default" is the system sound.
        sound: choice.silent ? null : choice.file ?? "default",
        vibrationPattern: [0, 300, 200, 300],
        enableVibrate: true,
      });
    } catch {
      // A failed channel costs the sound, not the timer.
    }
  }
}

/**
 * Play a sound the way a timer actually will.
 *
 * This deliberately goes through the notification system rather than playing
 * the file as media. Media playback would ignore the ringer switch and Focus
 * modes and so would tell the cook their timer is audible when it is not; a
 * real notification is silent in exactly the cases a real timer would be. The
 * banner it produces is the point, not a side effect.
 *
 * Returns false when nothing was scheduled, which the caller must explain
 * rather than swallow -- almost always because permission has not been granted.
 */
export async function previewTimerSound(sound: TimerSound): Promise<boolean> {
  if ((await getPermission()) !== "granted") return false;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: "timer-sound-preview",
      content: {
        title: "Timer sound",
        body: "This is how a finished timer will sound.",
        sound: soundValue(sound),
        ...(Platform.OS === "android" ? { channelId: timerChannelId(sound) } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        repeats: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** What the interface may truthfully say about alerts on this platform. */
export function soundCaveat(): string {
  return Platform.OS === "ios"
    ? "Alerts follow your ringer switch and Focus settings, so a timer may arrive silently."
    : "Alerts follow your Do Not Disturb settings, so a timer may arrive silently.";
}
