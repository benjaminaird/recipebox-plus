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
import { syncRecipes, describeResult } from "../../sync/syncRecipes";
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
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

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

  useFocusEffect(useCallback(() => { void loadDevices(); }, [loadDevices]));

  // Pull-only: this downloads, and there is no endpoint it could upload to.
  const runSync = useCallback(async () => {
    if (syncing || state.status !== "active") return;
    setSyncing(true);
    setSyncMessage("Looking for your recipes…");
    try {
      const result = await syncRecipes(auth, state.user.id, (p) => {
        setSyncMessage("Downloaded " + (p.stored + p.updated) + " so far…");
      });
      setSyncMessage(describeResult(result));
    } catch (err) {
      setSyncMessage(describeAuthError(err, "devices").title);
    } finally {
      setSyncing(false);
    }
  }, [auth, state, syncing]);

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
        {syncMessage ? <Notice message={{ title: syncMessage, tone: "info" }} /> : null}
        <Panel>
          <PanelRow
            first
            label={syncing ? "Downloading…" : "Download from your account"}
            detail={
              syncing
                ? "Leaving this screen will not stop it."
                : "Copies the recipes in your account onto this phone. Nothing on the phone is uploaded, and nothing here is overwritten."
            }
            action={syncing ? undefined : "Download"}
            onPress={syncing ? undefined : runSync}
          />
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
