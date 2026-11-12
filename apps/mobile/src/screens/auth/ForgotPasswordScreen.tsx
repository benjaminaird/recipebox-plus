// A forgotten password.
//
// There is one password-reset mechanism in RecipeBox and it lives on the web:
// a hashed, single-use, expiring link that opens the web app. The native
// client asks for that link rather than growing a second way to change a
// password — one fewer thing that can be wrong about the most dangerous
// operation an account has.
//
// The answer never says whether the address has an account. That is the whole
// reason a reset form is worth thinking about: it is otherwise a free tool for
// finding out who has signed up.
import { useCallback, useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { useAuth } from "../../auth/AuthProvider";
import { describeAuthError, type Message } from "../../auth/messages";
import type { RootStackParamList } from "../../navigation/types";
import { AuthScreen, Field, Notice, PrimaryButton, QuietButton } from "./AuthKit";

export function ForgotPasswordScreen() {
  const t = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "ForgotPassword">>();
  const auth = useAuth();

  const [email, setEmail] = useState(route.params?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const submit = useCallback(async () => {
    if (busy) return;
    setMessage(null);
    setBusy(true);
    try {
      await auth.requestPasswordReset(email.trim());
      setSent(true);
      setMessage({
        title: "Check your email",
        detail: `If ${email.trim()} has a RecipeBox account, a reset link is on its way. It opens RecipeBox in your browser and expires in an hour.`,
        tone: "info",
      });
    } catch (err) {
      setMessage(describeAuthError(err, "reset"));
    } finally {
      setBusy(false);
    }
  }, [auth, busy, email]);

  return (
    <AuthScreen
      title="Reset your password"
      lead="We will email you a link. You choose the new password in your browser."
      footer={<QuietButton label="Back to sign in" onPress={() => navigation.goBack()} />}
    >
      {message ? <Notice message={message} /> : null}

      <View style={{ gap: t.space.lg }}>
        <Field
          label="Email"
          value={email}
          onChangeText={(next) => { setEmail(next); setSent(false); }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="username"
          returnKeyType="send"
          placeholder="you@example.com"
          onSubmitEditing={submit}
          editable={!busy}
        />
        <PrimaryButton
          label={sent ? "Send another link" : "Send a reset link"}
          onPress={submit}
          busy={busy}
          disabled={email.trim().length === 0 || !auth.configured}
        />
      </View>
    </AuthScreen>
  );
}
