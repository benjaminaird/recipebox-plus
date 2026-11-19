// The account, once there is one.
//
// Three things belong here and nothing else: who is signed in, what state the
// session is in, and which devices can reach the account. The last one is the
// point of per-device sessions — "sign out my lost phone" is the whole reason
// a device list exists, and it is useless unless it is somewhere a worried
// person can find it.
//
// The screen is careful about one claim in particular. An account whose email
// was never actually confirmed — one that predates confirmations and was
// carried over — says so, rather than borrowing the word "confirmed" from
// accounts that earned it.
import { useCallback, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Alert, View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { textStyle } from "../../theme/fonts";
import { Text } from "react-native";
import { useAuth } from "../../auth/AuthProvider";
import { describeAuthError, staleMessage, type Message } from "../../auth/messages";
import type { DeviceSummary } from "../../auth/types";
import type { RootStackParamList } from "../../navigation/types";
import { useSync } from "../../sync/SyncProvider";
import { AuthScreen, Notice, Panel, PanelRow, PrimaryButton, QuietButton } from "./AuthKit";

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export function AccountScreen() {
  const t = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const auth = useAuth();
  const sync = useSync();
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [unadopted, setUnadopted] = useState<number>(0);

  const state = auth.state;
  const signedIn = state.status === "active" || state.status === "stale";

  const loadDevices = useCallback(async () => {
    if (state.status !== "active") return;
    try {
      setDevices(await auth.devices());
    } catch (err) {
      setMessage(describeAuthError(err, "devices"));
    }
  }, [auth, state.status]);

  const countUnadopted = useCallback(async () => {
    if (state.status !== "active") { setUnadopted(0); return; }
    setUnadopted((await sync.unadopted()).length);
  }, [sync, state.status]);

  useFocusEffect(useCallback(() => {
    void loadDevices();
    void sync.refresh();
    void countUnadopted();
  }, [loadDevices, sync, countUnadopted]));

  /**
   * Put this phone's own recipes into the account, at the cook's request.
   *
   * Signing in is not a request to publish everything on the phone — a shared
   * tablet has somebody else's cooking on it — so this is a deliberate action
   * with a count in front of it, and it is the only path by which a recipe
   * that predates the account becomes something this device will upload.
   */
  const confirmAdopt = useCallback(() => {
    Alert.alert(
      unadopted === 1 ? "Add 1 recipe to your account?" : `Add ${unadopted} recipes to your account?`,
      "These were on this phone before you signed in. Adding them copies them to your account, where your other devices will see them. Nothing is removed from this phone.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Add them",
          onPress: async () => {
            setBusy(true);
            try {
              for (const recipe of await sync.unadopted()) await sync.adopt(recipe.id);
              await countUnadopted();
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [sync, unadopted, countUnadopted]);

  const confirmRevoke = useCallback((entry: DeviceSummary) => {
    const isThis = entry.current;
    Alert.alert(
      isThis ? "Sign this device out?" : `Sign out ${entry.name}?`,
      isThis
        ? "You will need to sign in again on this device. Your recipes stay where they are."
        : "That device will be signed out the next time it does anything. Recipes already downloaded to it stay on it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await auth.revokeDevice(entry.id);
              if (!isThis) await loadDevices();
            } catch (err) {
              setMessage(describeAuthError(err, "devices"));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [auth, loadDevices]);

  const confirmSignOut = useCallback(() => {
    Alert.alert(
      "Sign out?",
      "Your recipes stay on this device and keep working. Signing in again picks them up where they are.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try { await auth.signOut(); } finally { setBusy(false); }
          },
        },
      ],
    );
  }, [auth]);

  if (!auth.ready) {
    return (
      <AuthScreen title="Account">
        <Text style={[textStyle("body"), { color: t.colors.textSecondary }]}>One moment…</Text>
      </AuthScreen>
    );
  }

  if (!signedIn) {
    return (
      <AuthScreen
        title="Account"
        lead="RecipeBox works without an account. Signing in adds your recipes on every device."
      >
        {state.status === "expired" ? (
          <Notice
            message={{
              title: "Your session has ended",
              detail: "Sign in again to reconnect. Nothing on this device has changed.",
              tone: "attention",
            }}
          />
        ) : null}
        {auth.droppedForeignCredential ? (
          <Notice
            message={{
              title: "Signed out by a reinstall",
              detail: "A saved session from a previous installation was found and discarded, which is deliberate: a reinstalled app starts signed out.",
              tone: "info",
            }}
          />
        ) : null}
        <PrimaryButton
          label={state.status === "expired" ? "Sign in again" : "Sign in"}
          onPress={() => navigation.navigate("SignIn", state.status === "expired" ? { reason: "expired" } : undefined)}
          disabled={!auth.configured}
        />
        <QuietButton label="Create an account" onPress={() => navigation.navigate("CreateAccount")} disabled={!auth.configured} />
        {auth.configured ? null : (
          <Notice
            message={{
              title: "No sign-in server",
              detail: "This build is not connected to a RecipeBox account server. Everything on this device still works.",
              tone: "attention",
            }}
          />
        )}
      </AuthScreen>
    );
  }

  const user = state.user;
  const confirmed = user.emailVerifiedAt
    ? `Confirmed ${when(user.emailVerifiedAt)}`
    : "Carried over from before confirmations";

  return (
    <AuthScreen title="Account">
      {message ? <Notice message={message} /> : null}
      {state.status === "stale" ? <Notice message={staleMessage(auth.persistentCredentials)} /> : null}

      <Panel>
        <PanelRow first label="Name" value={user.displayName || "—"} />
        <PanelRow label="Email" value={user.email} />
        <PanelRow label="Email address" value={confirmed} />
      </Panel>

      {state.status === "stale" ? (
        <QuietButton label="Try to reconnect" onPress={() => { void auth.retry(); }} disabled={busy} />
      ) : null}

      <View style={{ gap: t.space.sm }}>
        <Text accessibilityRole="header" style={[textStyle("sectionTitle"), { color: t.colors.text }]}>
          Your recipes
        </Text>
        {sync.message ? <Notice message={sync.message} /> : null}
        <Panel>
          <PanelRow
            first
            label={sync.status === "syncing" ? "Syncing…" : "Sync now"}
            detail={syncDetail(sync.status, sync.queued, sync.lastRunAt, sync.uploads)}
            action={sync.status === "syncing" ? undefined : "Sync"}
            onPress={sync.status === "syncing" ? undefined : () => { void sync.sync(); }}
          />
          {sync.conflicts > 0 ? (
            <PanelRow
              label={sync.conflicts === 1 ? "1 recipe changed in two places" : `${sync.conflicts} recipes changed in two places`}
              detail="Both versions of each are kept. Choose which to keep."
              action="Review"
              tone="danger"
              onPress={() => navigation.navigate("Conflicts")}
            />
          ) : null}
          {unadopted > 0 ? (
            <PanelRow
              label={unadopted === 1 ? "1 recipe is only on this phone" : `${unadopted} recipes are only on this phone`}
              detail="They were here before you signed in, so they are not in your account."
              action="Add them"
              onPress={confirmAdopt}
            />
          ) : null}
          <PanelRow label="Trash" detail="Recipes you have deleted." action="Open" onPress={() => navigation.navigate("Trash")} />
        </Panel>
      </View>

      <View style={{ gap: t.space.sm }}>
        <Text accessibilityRole="header" style={[textStyle("sectionTitle"), { color: t.colors.text }]}>
          Devices
        </Text>
        {devices === null ? (
          <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>
            {state.status === "stale" ? "Not available while offline." : "Looking…"}
          </Text>
        ) : (
          <Panel>
            {devices.map((entry, index) => (
              <PanelRow
                key={entry.id}
                first={index === 0}
                label={entry.current ? `${entry.name} (this device)` : entry.name}
                detail={`Last used ${when(entry.lastSeenAt)}`}
                action="Sign out"
                tone="danger"
                onPress={() => confirmRevoke(entry)}
              />
            ))}
          </Panel>
        )}
        <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>
          Signing a device out stops it reaching the account straight away. Recipes already on it stay on it.
        </Text>
      </View>

      {auth.localStore?.isolated ? (
        <Notice
          message={{
            title: "A separate library on this device",
            detail: "Another account already uses the library on this phone, so yours is kept apart from it. Neither can see the other.",
            tone: "info",
          }}
        />
      ) : null}

      <QuietButton label="Sign out" tone="danger" onPress={confirmSignOut} disabled={busy} />
    </AuthScreen>
  );
}

/**
 * What the Sync row says underneath itself.
 *
 * It answers the question a cook actually has, which is not "what is the
 * state machine in" but "is my cooking safe". So it leads with what is owed
 * and when it last worked, and says plainly when this build cannot upload —
 * because a build that only downloads, saying nothing, looks exactly like one
 * that is uploading and failing.
 */
function syncDetail(
  status: string, queued: number, lastRunAt: number | null, uploads: boolean,
): string {
  const owed = queued === 0 ? "" : queued === 1
    ? "1 change is waiting to go up. "
    : `${queued} changes are waiting to go up. `;

  if (!uploads) {
    return owed
      + "This build downloads from your account and keeps what you change here safe on the phone; "
      + "uploading is not switched on yet, and nothing is lost by waiting.";
  }
  if (status === "offline") {
    return owed + "The last attempt could not reach your account. It will carry on from where it stopped.";
  }
  if (status === "pending") return owed + "Tap to send them now.";
  if (lastRunAt) {
    const mins = Math.floor((Date.now() - lastRunAt) / 60_000);
    const ago = mins < 1 ? "a moment ago" : mins < 60 ? `${mins} minutes ago` : "earlier today";
    return `Everything is in step. Last checked ${ago}.`;
  }
  return "Copies changes both ways between this phone and your account.";
}
