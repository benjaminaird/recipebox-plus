// The Recipe Helper: a conversation that ends in an approval, or in nothing.
//
// ADR 0016 fixes the sequence, and the screen is built around it rather than
// around a chat window that happens to produce recipes:
//
//   The cook says what they want. The Helper talks back, and may ask a
//   question instead of guessing. When it has something to propose it says so
//   in plain English FIRST — what it would change and why — and the concrete
//   changes are below that, because a diff answers "what" and the cook's
//   judgement is about "why".
//
//   The proposal is a draft. Reject, ask for something else, pick one of the
//   alternatives, or just keep talking: the input stays live under an open
//   proposal, and typing into it is how refining works.
//
//   Nothing is saved until Accept. Accepting writes a version (ADR 0015), so
//   the change can be undone from the recipe's history afterwards.
//
// What this screen will not do: tell a cook a recipe is safe. The Helper's
// uncertainties are shown as its own words, under a heading that says they are
// what it is unsure of — never flattened into the summary, where they would
// read as reassurance.

import { useCallback, useEffect, useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  ActivityIndicator, Alert, Pressable, Text, TextInput, View,
} from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { textStyle } from "../theme/fonts";
import { useAuth } from "../auth/AuthProvider";
import { useSync } from "../sync/SyncProvider";
import { AuthApiError, AuthNetworkError } from "../auth/types";
import { getRecipe, saveRecipe } from "../data/db";
import type { Recipe } from "../data/types";
import type { RootStackParamList } from "../navigation/types";
import { AuthScreen, Notice, PrimaryButton, QuietButton } from "./auth/AuthKit";
import {
  acceptProposal, alternativeMessage, dropConversation, heldConversation, helperPath,
  helperRequest, historyNote, holdConversation, readAnswer, withAnswer, withQuestion,
  withRejection, HELPER_PROMPTS,
  type Conversation, type HelperAnswer,
} from "../ai/helper";

/** One side of the conversation. */
function Said({ role, text }: { role: "user" | "helper"; text: string }) {
  const t = useTheme();
  const mine = role === "user";
  return (
    <View
      style={{
        alignSelf: mine ? "flex-end" : "flex-start",
        maxWidth: "88%",
        backgroundColor: mine ? t.colors.surfaceRaised : t.colors.surface,
        borderColor: t.colors.separator,
        borderWidth: 1,
        borderRadius: t.radius.md,
        paddingHorizontal: t.space.md,
        paddingVertical: t.space.sm,
      }}
    >
      <Text style={[textStyle("body"), { color: mine ? t.colors.text : t.colors.textSecondary }]}>{text}</Text>
    </View>
  );
}

/** The change, line by line: what each row is now and what it would become. */
function ChangeList({ answer }: { answer: HelperAnswer }) {
  const t = useTheme();
  if (answer.rows.length === 0) return null;
  return (
    <View style={{ gap: t.space.sm }}>
      <Text accessibilityRole="header" style={[textStyle("sectionTitle"), { color: t.colors.text }]}>
        {answer.rows.length === 1 ? "The change" : "The changes"}
      </Text>
      <View
        style={{
          borderColor: t.colors.separator, borderWidth: 1, borderRadius: t.radius.md,
          backgroundColor: t.colors.surface, overflow: "hidden",
        }}
      >
        {answer.rows.map((row, index) => (
          <View
            key={index}
            style={{
              paddingHorizontal: t.space.md,
              paddingVertical: t.space.sm,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: t.colors.separator,
              gap: 3,
            }}
          >
            <Text style={[textStyle("eyebrow"), { color: t.colors.textTertiary }]}>{row.label}</Text>
            {row.before ? (
              <Text style={[textStyle("body"), { color: t.colors.textSecondary, textDecorationLine: row.after ? "none" : "line-through" }]}>
                {row.before}
              </Text>
            ) : null}
            {row.after ? (
              <Text style={[textStyle("body"), { color: t.colors.text, fontWeight: "600" }]}>{row.after}</Text>
            ) : null}
            {row.why ? (
              <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>{row.why}</Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/** A list the Helper gave: what the cook gives up, or what it is unsure of. */
function Points({ title, points, tone }: { title: string; points: string[]; tone: "quiet" | "attention" }) {
  const t = useTheme();
  if (points.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={[textStyle("eyebrow"), {
        color: tone === "attention" ? t.colors.attention : t.colors.textTertiary,
      }]}>
        {title}
      </Text>
      {points.map((point, index) => (
        <Text key={index} style={[textStyle("footnote"), { color: t.colors.textSecondary }]}>• {point}</Text>
      ))}
    </View>
  );
}

export function RecipeHelperScreen() {
  const t = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "RecipeHelper">>();
  const auth = useAuth();
  const sync = useSync();
  const recipeId = route.params.recipeId;

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [shared, setShared] = useState<{ shared: boolean; ownerName: string | null }>({ shared: false, ownerName: null });
  const [conversation, setConversation] = useState<Conversation>(() => heldConversation(recipeId));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const found = await getRecipe(recipeId);
      if (!live) return;
      setRecipe(found);
      const provenance = await sync.provenance(recipeId);
      if (live) setShared({ shared: provenance.shared, ownerName: provenance.ownerName });
    })();
    return () => { live = false; };
  }, [recipeId, sync]);

  // Held for the life of the process, so checking an ingredient on the recipe
  // and coming back does not throw away a negotiation in progress.
  useEffect(() => { holdConversation(conversation); }, [conversation]);

  const ask = useCallback(async (message: string) => {
    const text = message.trim();
    if (!text || !recipe || busy) return;
    setError("");
    setDraft("");
    const asked = withQuestion(conversation, text);
    setConversation(asked);
    setBusy(true);
    try {
      const payload = await auth.authorized(helperPath(recipeId), {
        method: "POST",
        body: helperRequest(conversation, recipe, text),
      });
      const answer = readAnswer(payload);
      if (!answer) {
        setError("The Helper answered in a way this version of the app could not read.");
        return;
      }
      setConversation(withAnswer(asked, answer));
    } catch (err) {
      // The distinction the whole auth layer is built on, and it matters here
      // more than anywhere: offline is not a refusal, and saying "something
      // went wrong" to a cook standing in a kitchen with no signal is useless.
      if (err instanceof AuthNetworkError) {
        setError("The Helper needs a connection. Everything else — reading, scaling, cooking, editing — works offline.");
      } else if (err instanceof AuthApiError) {
        setError(err.message);
      } else {
        setError("The Helper could not be reached.");
      }
    } finally {
      setBusy(false);
    }
  }, [auth, busy, conversation, recipe, recipeId]);

  const accept = useCallback(() => {
    const answer = conversation.pending;
    if (!answer || !recipe || busy) return;

    const mine = !shared.shared;
    const confirm = mine
      ? {
        title: "Save this change?",
        body: "It becomes the current version of the recipe. The version you have now is kept in the recipe's history, so you can go back to it.",
        verb: "Save it",
      }
      : {
        title: "Save as your own copy?",
        body: `${shared.ownerName ? shared.ownerName + "'s" : "The"} recipe is not yours to change. This saves a copy of your own, with the change, and leaves theirs exactly as it is.`,
        verb: "Save my copy",
      };

    Alert.alert(confirm.title, confirm.body, [
      { text: "Cancel", style: "cancel" },
      {
        text: confirm.verb,
        onPress: async () => {
          setBusy(true);
          setError("");
          try {
            const applied = acceptProposal(recipe, answer);
            if (!applied.ok) { setError(applied.reason); return; }

            if (mine) {
              await saveRecipe(applied.recipe, { cause: "helper", note: historyNote(answer) });
              dropConversation(recipeId);
              navigation.goBack();
              return;
            }
            // Somebody else's recipe. A3's rule: only the owner may change the
            // original, so an accepted change becomes the cook's own copy.
            const copy = await sync.saveMyCopy(applied.recipe, shared.ownerName);
            if (!copy) {
              setError("That copy could not be saved. Nothing was changed.");
              return;
            }
            dropConversation(recipeId);
            navigation.replace("RecipeDetail", { recipeId: copy.id });
          } catch (err) {
            setError(err instanceof Error ? err.message : "That change could not be saved.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [busy, conversation.pending, navigation, recipe, recipeId, shared, sync]);

  if (!auth.configured) {
    return (
      <AuthScreen title="Recipe Helper">
        <Notice message={{
          title: "This copy of RecipeBox has no server",
          detail: "The Helper runs on the server, so it is not available in this build. Everything on the phone works as it did.",
          tone: "info",
        }} />
        <QuietButton label="Back" onPress={() => navigation.goBack()} />
      </AuthScreen>
    );
  }

  if (auth.state.status === "signed-out" || auth.state.status === "expired") {
    return (
      <AuthScreen title="Recipe Helper">
        <Notice message={{
          title: "Sign in to use the Helper",
          detail: "It runs on the server, which is what keeps the AI key off your phone and your recipes off anybody's laptop.",
          tone: "info",
        }} />
        <PrimaryButton label="Sign in" onPress={() => navigation.navigate("SignIn")} />
        <QuietButton label="Back" onPress={() => navigation.goBack()} />
      </AuthScreen>
    );
  }

  if (!recipe) {
    return (
      <AuthScreen title="Recipe Helper">
        <Text style={[textStyle("body"), { color: t.colors.textSecondary }]}>One moment…</Text>
      </AuthScreen>
    );
  }

  const pending = conversation.pending;

  return (
    <AuthScreen
      title="Recipe Helper"
      lead={`Ask for a change to ${recipe.title}. Nothing is saved until you say so.`}
    >
      {shared.shared ? (
        <Notice message={{
          title: shared.ownerName ? `${shared.ownerName}'s recipe` : "Shared with you",
          detail: "You can ask the Helper about it. Saving a change makes a copy of your own and leaves theirs alone.",
          tone: "info",
        }} />
      ) : null}

      {conversation.turns.length === 0 ? (
        <View style={{ gap: t.space.sm }}>
          <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>
            Try one of these, or ask in your own words.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space.xs }}>
            {HELPER_PROMPTS.map((prompt) => (
              <Pressable
                key={prompt}
                accessibilityRole="button"
                onPress={() => void ask(prompt)}
                disabled={busy}
                style={{
                  borderColor: t.colors.separator, borderWidth: 1, borderRadius: t.radius.sm,
                  paddingHorizontal: t.space.sm, paddingVertical: 8, minHeight: 36,
                  backgroundColor: t.colors.surface, opacity: busy ? 0.5 : 1,
                }}
              >
                <Text style={[textStyle("footnote"), { color: t.colors.text }]}>{prompt}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {conversation.turns.map((turn, index) => (
        <Said key={index} role={turn.role} text={turn.text} />
      ))}

      {busy ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
          <ActivityIndicator />
          <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>Thinking about your recipe…</Text>
        </View>
      ) : null}

      {error ? (
        <Notice message={{ title: "Not this time", detail: error, tone: "attention" }} />
      ) : null}

      {pending ? (
        <View style={{ gap: t.space.md }}>
          <ChangeList answer={pending} />
          <Points title="What you give up" points={pending.tradeoffs} tone="quiet" />
          <Points title="What the Helper is not sure of" points={pending.uncertainties} tone="attention" />

          <View style={{ gap: t.space.sm }}>
            <PrimaryButton
              label={shared.shared ? "Save as my own copy" : "Save this change"}
              onPress={accept}
              disabled={busy}
            />
            <QuietButton label="No, suggest something else" onPress={() => setConversation(withRejection(conversation))} disabled={busy} />
            {pending.alternatives.map((alternative) => (
              <QuietButton
                key={alternative.label}
                label={alternative.label}
                onPress={() => void ask(alternativeMessage(alternative))}
                disabled={busy}
              />
            ))}
            {pending.alternatives.length ? (
              <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>
                {pending.alternatives.map((a) => `${a.label}: ${a.summary}`).join("\n")}
              </Text>
            ) : null}
            <Text style={[textStyle("footnote"), { color: t.colors.textTertiary }]}>
              Saving keeps the version you have now in the recipe's history, so you can go back to it.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={{ gap: t.space.xs }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          editable={!busy}
          multiline
          placeholder={pending ? "Or say what to change about it…" : "What would you like to change?"}
          placeholderTextColor={t.colors.textTertiary}
          accessibilityLabel="What would you like to change?"
          style={[textStyle("body"), {
            color: t.colors.text,
            backgroundColor: t.colors.surface,
            borderColor: t.colors.separator,
            borderWidth: 1,
            borderRadius: t.radius.md,
            paddingHorizontal: t.space.md,
            paddingVertical: t.space.sm,
            minHeight: 48,
          }]}
        />
        <PrimaryButton label="Ask the Helper" onPress={() => void ask(draft)} disabled={busy || !draft.trim()} />
      </View>
    </AuthScreen>
  );
}
