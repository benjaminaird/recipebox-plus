// Import, and reviewing what came out of it.
//
// ADR 0014: review happens in context, and an unresolved recipe can still be
// saved. So this is not a gate. It is the recipe as read, with the parts worth
// a second look marked, and a way in to fix them.
//
// The URL field is connected: the server fetches the page and the extractor
// here reads it, which is the arrangement in docs/native-import-contract.md.
// When there is no server to ask, the field says so rather than accepting a
// link and failing -- a box that takes a link and then breaks teaches a cook
// that the app is broken rather than unconfigured.
//
// An import is saved LOCALLY and marked local. Nothing is uploaded, and the
// recipe always gets a new id, so importing the same page twice makes two
// recipes rather than quietly overwriting one that may since have been edited.
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeProvider";
import { inputStyle, maxScale, textStyle } from "../theme/fonts";
import { saveRecipe } from "../data/db";
import { markRecipeLocal } from "../data/syncStore";
import { useAuth } from "../auth/AuthProvider";
import { describeImportError, fetchPageForImport, looksLikeUrl, needsSignIn, type FetchedPage } from "../sync/importUrl";
import type { Message } from "../auth/messages";
import { Notice } from "./auth/AuthKit";
import { missingFields, reviewFromHtml, sentenceList, sourceExplanation } from "../domain/importReview";
import { SAMPLE_IMPORTS } from "../data/sampleImports";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function newRecipeId(): string {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ImportReviewScreen() {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const auth = useAuth();
  const [url, setUrl] = useState("");
  const [sampleIndex, setSampleIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState<FetchedPage | null>(null);
  const [fetchError, setFetchError] = useState<Message | null>(null);

  const sample = SAMPLE_IMPORTS[sampleIndex];
  // A fetched page takes over from the example. The extractor does not know or
  // care which it was given, which is the point.
  const pageHtml = fetched ? fetched.html : sample.html;
  const pageUrl = fetched ? fetched.finalUrl : sample.url;
  const review = useMemo(() => reviewFromHtml(pageHtml, pageUrl), [pageHtml, pageUrl]);
  const missing = useMemo(() => missingFields(review.fields), [review]);

  const signedIn = auth.state.status === "active" || auth.state.status === "stale";
  const canImport = auth.configured && signedIn && looksLikeUrl(url) && !fetching;

  const runImport = useCallback(async () => {
    if (!canImport) return;
    setFetching(true);
    setFetchError(null);
    try {
      const page = await fetchPageForImport(auth, url);
      setFetched(page);
    } catch (err) {
      setFetchError(describeImportError(err));
      if (needsSignIn(err)) navigation.navigate("SignIn", { reason: "expired" });
    } finally {
      setFetching(false);
    }
  }, [auth, canImport, navigation, url]);

  const save = useCallback(async () => {
    if (!review.recipe) return;
    setSaving(true);
    try {
      // A new id: importing the same page twice makes two recipes, not a
      // silent overwrite of one the cook may have since edited.
      const id = newRecipeId();
      await saveRecipe({
        ...review.recipe,
        id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Made here, so recorded as made here. Sync offers local recipes for
      // upload only when the cook asks; it never sends them on its own.
      await markRecipeLocal(id);
      navigation.goBack();
    } catch {
      setSaving(false);
      Alert.alert("Could not save", "Nothing has been lost. Try again in a moment.");
    }
  }, [review.recipe, navigation]);

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: t.space.sm,
          paddingBottom: insets.bottom + t.space.huge * 2,
          paddingHorizontal: t.space.screenGutter,
          gap: t.space.xxl,
        }}
      >
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={maxScale("largeTitle")}
          style={[textStyle("largeTitle"), { color: c.text }]}
        >
          Import a recipe
        </Text>

        <View style={{ gap: t.space.sm }}>
          <View style={[styles.field, { backgroundColor: c.surface, borderRadius: t.radius.sm, borderColor: c.separatorStrong, minHeight: t.minTouch }]}>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Recipe web address"
              style={[inputStyle("body"), { color: c.text, flex: 1 }]}
            />
          </View>
          <Pressable
            onPress={runImport}
            disabled={!canImport}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canImport, busy: fetching }}
            accessibilityLabel="Read this recipe page"
            style={({ pressed }) => [
              styles.importButton,
              {
                backgroundColor: canImport ? c.accent : c.sunken,
                borderRadius: t.radius.sm,
                minHeight: t.minTouch,
                opacity: fetching ? 0.75 : pressed ? 0.85 : 1,
              },
            ]}
          >
            {fetching ? <ActivityIndicator color={c.onAccent} /> : null}
            <Text style={[textStyle("headline"), { color: canImport ? c.onAccent : c.textTertiary, fontWeight: "600" }]}>
              {fetching ? "Reading the page…" : "Read this page"}
            </Text>
          </Pressable>

          {fetchError ? <Notice message={fetchError} /> : null}

          {!auth.configured ? (
            <Pressable
              onPress={() =>
                Alert.alert(
                  "No import server",
                  "This build is not connected to a RecipeBox server, so links cannot be fetched. The review below is the real importer running on a stored example, so what you see is what you would get.",
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Why links cannot be fetched in this build"
              style={({ pressed }) => [styles.notice, { backgroundColor: c.attentionSoft, borderRadius: t.radius.sm, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name="information-circle-outline" size={18} color={c.attention} />
              <Text style={[textStyle("footnote"), { color: c.attention, flex: 1 }]}>
                This build has no import server. Tap to read why.
              </Text>
            </Pressable>
          ) : !signedIn ? (
            <Pressable
              onPress={() => navigation.navigate("SignIn", undefined)}
              accessibilityRole="button"
              accessibilityLabel="Sign in to import from a link"
              style={({ pressed }) => [styles.notice, { backgroundColor: c.accentSoft, borderRadius: t.radius.sm, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name="log-in-outline" size={18} color={c.accentText} />
              <Text style={[textStyle("footnote"), { color: c.accentText, flex: 1 }]}>
                Sign in to read a page from a link. Writing a recipe out works either way.
              </Text>
            </Pressable>
          ) : null}

          {fetched ? (
            <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
              Read from {fetched.finalUrl}
              {fetched.via === "proxy" ? " (through the fallback reader)" : ""}
            </Text>
          ) : null}
        </View>

        {fetched ? null : (
        <View style={{ gap: t.space.sm }}>
          <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>Example pages</Text>
          <View style={styles.pillRow}>
            {SAMPLE_IMPORTS.map((s, i) => (
              <Pressable
                key={s.id}
                onPress={() => setSampleIndex(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: i === sampleIndex }}
                accessibilityLabel={s.label}
                style={({ pressed }) => [
                  styles.pill,
                  {
                    backgroundColor: i === sampleIndex ? c.accent : c.surface,
                    borderColor: i === sampleIndex ? c.accent : c.separatorStrong,
                    borderRadius: t.radius.pill,
                    minHeight: t.minTouch,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Text style={[textStyle("footnote"), { color: i === sampleIndex ? c.onAccent : c.text, fontWeight: "600" }]}>
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        )}

        {/* How it was read. Structured data is the publisher's own statement;
            scraped prose is our reading of it, and the difference is worth
            showing rather than averaging into one confidence number. */}
        <View style={[styles.card, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
          <Text style={[textStyle("cardTitle"), { color: c.text }]}>
            {review.recipe ? review.recipe.title : "Nothing could be read"}
          </Text>
          <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>
            {sourceExplanation(review.source)}
          </Text>
          {review.confidence !== null ? (
            <Text style={[textStyle("footnote"), { color: c.textTertiary }]}>
              {Math.round(review.confidence * 100)}% of the ingredients were found in the page
              itself.
            </Text>
          ) : null}
        </View>

        {missing.length > 0 ? (
          <View style={{ gap: t.space.xs }}>
            <Text style={[textStyle("eyebrow"), { color: c.attention }]}>Not on the page</Text>
            <Text style={[textStyle("body"), { color: c.textSecondary }]}>
              This page does not give {sentenceList(missing)}. Nothing has been filled in for you —
              you can add it after saving.
            </Text>
          </View>
        ) : null}

        {review.concerns.length > 0 ? (
          <View style={{ gap: t.space.sm }}>
            <Text style={[textStyle("eyebrow"), { color: c.attention }]}>Worth a look</Text>
            {review.concerns.map((concern) => (
              <View key={concern.ingredientId} style={[styles.concern, { backgroundColor: c.attentionSoft, borderRadius: t.radius.sm }]}>
                <Text style={[textStyle("body"), { color: c.text }]}>{concern.name}</Text>
                <Text style={[textStyle("footnote"), { color: c.attention }]}>
                  {concern.reason === "no-amount"
                    ? "No amount given on the page"
                    : "Not found in the page text"}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {review.recipe ? (
          <View style={{ gap: t.space.sm }}>
            <Text style={[textStyle("eyebrow"), { color: c.textTertiary }]}>
              As read — {review.fields.ingredients} ingredients, {review.fields.steps} steps
            </Text>
            {review.recipe.sections.flatMap((s) => s.ingredients).map((ingredient) => {
              const uncertain = review.concerns.some((x) => x.ingredientId === ingredient.id);
              return (
                <View key={ingredient.id} style={styles.line}>
                  <Text
                    style={[
                      textStyle("body"),
                      { color: uncertain ? c.attention : c.text, width: 92 },
                    ]}
                  >
                    {[ingredient.amount, ingredient.unit].filter(Boolean).join(" ") || "—"}
                  </Text>
                  <Text style={[textStyle("body"), { color: c.text, flex: 1 }]}>
                    {ingredient.name}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.bar, { backgroundColor: c.surface, borderTopColor: c.separator, paddingBottom: insets.bottom + 10 }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [styles.secondary, { borderColor: c.separatorStrong, borderRadius: t.radius.md, minHeight: t.minTouch, opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[textStyle("footnote"), { color: c.textSecondary }]}>Close</Text>
        </Pressable>
        <Pressable
          onPress={save}
          disabled={!review.recipe || saving}
          accessibilityRole="button"
          accessibilityLabel="Save this recipe, unresolved parts and all"
          style={({ pressed }) => [
            styles.primary,
            {
              backgroundColor: c.accent,
              borderRadius: t.radius.md,
              minHeight: t.minTouch,
              opacity: !review.recipe || saving || pressed ? 0.75 : 1,
            },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={c.onAccent} />
          ) : (
            <Text style={[textStyle("headline"), { color: c.onAccent }]}>Save anyway</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  importButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  card: { padding: 16, gap: 6 },
  concern: { padding: 12, gap: 2 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 4 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  bar: { flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  secondary: { flex: 1, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  primary: { flex: 2, alignItems: "center", justifyContent: "center" },
});
