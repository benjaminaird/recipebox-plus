// Waiting for a confirmation link.
//
// This screen cannot know when the link has been opened — it is opened in a
// browser, on whatever device the mail arrived on. So it does not pretend to
// poll or to watch. It explains what to look for, offers to send the link
// again, and gives the cook the one button that resolves it: try signing in.
//
// Sending again needs the password, because an endpoint that mails anyone on
// request is an endpoint for mailing strangers. The password is held here, in
// this screen's state, and goes nowhere else.
import { useCallback, useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { useAuth } from "../../auth/AuthProvider";
import { describeAuthError, type Message } from "../../auth/messages";
import type { RootStackParamList } from "../../navigation/types";
import { AuthScreen, Field, Notice, PrimaryButton, QuietButton } from "./AuthKit";

export function VerifyEmailScreen() {
  const t = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "VerifyEmail">>();
  const auth = useAuth();

  const email = route.params.email;
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(
    route.params.emailSent
      ? { title: "Check your email", detail: `We sent a confirmation link to ${email}. The link is good for 24 hours.`, tone: "info" }
      : {
          title: "The confirmation email could not be sent",
          detail: "The account exists and is waiting to be confirmed, but this server cannot send email yet. Nothing you did is wrong.",
          tone: "attention",
        },
  );

  const resend = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await auth.resendVerification(email, password);
      // The answer is the same whatever happened — the endpoint will not say
      // whether an account exists — so the screen does not claim more than it
      // knows either.
      setMessage({
        title: "Sent, if that password was right",
        detail: `If the details match an account waiting to be confirmed, a new link is on its way to ${email}.`,
        tone: "info",
      });
      setPassword("");
    } catch (err) {
      setMessage(describeAuthError(err, "verify"));
    } finally {
      setBusy(false);
    }
  }, [auth, busy, email, password]);

  return (
    <AuthScreen
      title="Confirm your email"
      lead="RecipeBox sends one link to prove the address is yours. Open it in the browser, then come back and sign in."
      footer={
        <QuietButton
          label="Keep cooking without an account"
          tone="plain"
          onPress={() => navigation.getParent()?.goBack() ?? navigation.goBack()}
        />
      }
    >
      {message ? <Notice message={message} /> : null}

      <PrimaryButton label="I have confirmed — sign in" onPress={() => navigation.replace("SignIn", { email })} />

      <View style={{ gap: t.space.lg }}>
        <Field
          label="Password"
          hint="Needed to send the link again, so that nobody else can have it sent to you."
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="send"
          onSubmitEditing={resend}
          editable={!busy}
        />
        <QuietButton label="Send the link again" onPress={resend} disabled={busy || password.length === 0} />
      </View>
    </AuthScreen>
  );
}
