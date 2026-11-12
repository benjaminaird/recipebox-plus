// Sign in.
//
// The screen is written as an offer rather than a gate, because that is what it
// is: RecipeBox is a local-first cookbook and every recipe on this device is
// readable without an account. So the way out is a real control at the bottom,
// not a greyed-out hint, and nothing here implies the app is waiting to be
// unlocked.
//
// It is also the reconnect screen. A session that ends arrives here with
// `reason: "expired"`, and the only difference is the first thing it says.
import { useCallback, useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { useAuth } from "../../auth/AuthProvider";
import { describeAuthError, type Message } from "../../auth/messages";
import { AuthApiError } from "../../auth/types";
import type { RootStackParamList } from "../../navigation/types";
import { AuthScreen, Field, Notice, PrimaryButton, QuietButton } from "./AuthKit";

export function SignInScreen() {
  const t = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "SignIn">>();
  const auth = useAuth();

  const expired = route.params?.reason === "expired";
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(
    expired
      ? { title: "Your session has ended", detail: "Sign in to reconnect. Everything on this device is untouched.", tone: "attention" }
      : null,
  );

  const submit = useCallback(async () => {
    if (busy) return;
    setMessage(null);
    setBusy(true);
    try {
      await auth.signIn(email.trim(), password);
      navigation.goBack();
    } catch (err) {
      // An unconfirmed account is not a failed sign-in; it is the next step,
      // and the screen that explains it already exists.
      if (err instanceof AuthApiError && err.code === "email_verification_required") {
        navigation.replace("VerifyEmail", { email: email.trim(), emailSent: err.verificationEmailSent });
        return;
      }
      setMessage(describeAuthError(err, "signin"));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }, [auth, busy, email, navigation, password]);

  const ready = email.trim().length > 0 && password.length > 0;

  return (
    <AuthScreen
      title={expired ? "Sign in again" : "Sign in"}
      lead={
        expired
          ? "RecipeBox could not renew your session."
          : "Your recipes, on every device you cook from."
      }
      footer={
        <>
          <QuietButton label="Create an account" onPress={() => navigation.replace("CreateAccount")} />
          <QuietButton
            label="Forgot your password?"
            tone="plain"
            onPress={() => navigation.navigate("ForgotPassword", { email: email.trim() || undefined })}
          />
          {/* Last, and a real control: the way out of this screen is not a
              greyed-out hint, because cooking without an account is a
              supported way to use RecipeBox rather than a lesser one. */}
          <QuietButton label="Keep cooking without an account" tone="plain" onPress={() => navigation.goBack()} />
        </>
      }
    >
      {message ? <Notice message={message} /> : null}

      {auth.configured ? null : (
        <Notice
          message={{
            title: "No sign-in server",
            detail: "This build is not connected to a RecipeBox account server, so there is nothing to sign in to yet. Every recipe on this device still works.",
            tone: "attention",
          }}
        />
      )}

      <View style={{ gap: t.space.lg }}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="username"
          returnKeyType="next"
          placeholder="you@example.com"
          editable={!busy}
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!busy}
        />
        <PrimaryButton
          label={expired ? "Reconnect" : "Sign in"}
          onPress={submit}
          busy={busy}
          disabled={!ready || !auth.configured}
        />
        {!auth.persistentCredentials && auth.configured ? (
          <Notice
            message={{
              title: "This build cannot store a session securely",
              detail: "Secure storage is unavailable here, so you will be signed out when the app closes.",
              tone: "attention",
            }}
          />
        ) : null}
      </View>

    </AuthScreen>
  );
}
