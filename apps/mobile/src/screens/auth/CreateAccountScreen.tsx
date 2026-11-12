// Create an account.
//
// The same account the web app uses: one `profiles` row, one password rule,
// one definition of who you are. Nothing here invents a second identity, and
// the screen says plainly what happens next, because what happens next is not
// "you are signed in" — a new account confirms its email first.
import { useCallback, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { useAuth } from "../../auth/AuthProvider";
import { describeAuthError, type Message } from "../../auth/messages";
import { AuthApiError } from "../../auth/types";
import type { RootStackParamList } from "../../navigation/types";
import { AuthScreen, Field, Notice, PrimaryButton, QuietButton } from "./AuthKit";

const MIN_PASSWORD = 6;

export function CreateAccountScreen() {
  const t = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const auth = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [taken, setTaken] = useState(false);

  const submit = useCallback(async () => {
    if (busy) return;
    setMessage(null);
    setTaken(false);
    setBusy(true);
    try {
      const result = await auth.signUp(email.trim(), password, name.trim());
      navigation.replace("VerifyEmail", { email: email.trim(), emailSent: result.verificationEmailSent });
    } catch (err) {
      setMessage(describeAuthError(err, "signup"));
      // "That email already has an account" is the one failure with an obvious
      // next move, and it gets a button for it below.
      setTaken(err instanceof AuthApiError && err.code === "email_taken");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }, [auth, busy, email, name, navigation, password]);

  const ready = email.trim().length > 0 && password.length >= MIN_PASSWORD;

  return (
    <AuthScreen
      title="Create an account"
      lead="One account for RecipeBox on the web and on your devices."
      footer={<QuietButton label="I already have an account" onPress={() => navigation.replace("SignIn")} />}
    >
      {message ? <Notice message={message} /> : null}

      <View style={{ gap: t.space.lg }}>
        <Field
          label="Your name"
          hint="What RecipeBox calls you. You can leave it blank."
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          editable={!busy}
        />
        <Field
          label="Email"
          hint="We send one confirmation link here before the account can be used."
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
          hint={`At least ${MIN_PASSWORD} characters.`}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!busy}
        />
        <PrimaryButton label="Create account" onPress={submit} busy={busy} disabled={!ready || !auth.configured} />
      </View>

      {taken ? (
        <QuietButton label="Sign in instead" onPress={() => navigation.replace("SignIn", { email: email.trim() })} />
      ) : null}
    </AuthScreen>
  );
}
