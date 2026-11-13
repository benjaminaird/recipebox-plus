// Importing from a link: what counts as a link, and what each failure says.
//
// The fetch itself is one call through the session manager, so what is worth
// testing is the parts that decide — whether to spend a request at all, and
// what to tell a cook when the answer is no. Every one of those messages is a
// moment where the app either helps or teaches somebody that it is broken.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  describeImportError, fetchPageForImport, looksLikeUrl, needsSignIn, tidyUrl,
} from "../src/sync/importUrl.ts";
import { AuthApiError, AuthNetworkError } from "../src/auth/types.ts";

const page = {
  url: "https://example.test/recipe",
  finalUrl: "https://example.test/recipe",
  html: "<!doctype html><html><body><h1>A Recipe</h1></body></html>",
  htmlHash: "sha256:abc",
  via: "direct" as const,
  fetchedAt: 1763000000000,
};

// ---------------------------------------------------------------------------
// What counts as a link
// ---------------------------------------------------------------------------

test("a plausible recipe link is accepted", () => {
  for (const url of [
    "https://www.bbcgoodfood.com/recipes/classic-scones",
    "http://example.com/a/b?c=d#e",
    "https://sub.domain.co.uk/recipe",
  ]) assert.equal(looksLikeUrl(url), true, url);
});

test("what is not a link is refused before a request is spent", () => {
  for (const url of [
    "", "   ", "banana bread", "example.com/recipe", "ftp://example.com/x",
    "file:///etc/passwd", "javascript:alert(1)", "https://", "https://localhost",
  ]) assert.equal(looksLikeUrl(url), false, JSON.stringify(url));
});

test("a link pasted with the mess around it still works", () => {
  // Share sheets and chat apps wrap and follow links with punctuation.
  assert.equal(tidyUrl("  https://example.com/recipe  "), "https://example.com/recipe");
  assert.equal(tidyUrl("<https://example.com/recipe>"), "https://example.com/recipe");
  assert.equal(tidyUrl("Look at https://example.com/recipe, it is good"), "https://example.com/recipe");
  assert.equal(tidyUrl("https://example.com/recipe."), "https://example.com/recipe");
  assert.equal(tidyUrl("try https://example.com/a/b?c=d"), "https://example.com/a/b?c=d");
});

// ---------------------------------------------------------------------------
// The fetch
// ---------------------------------------------------------------------------

test("the page is fetched through the session, as a POST to the versioned endpoint", async () => {
  const calls: { path: string; init: unknown }[] = [];
  const session = {
    async authorized(path: string, init?: { method?: string; body?: unknown }) {
      calls.push({ path, init });
      return page;
    },
  };
  const result = await fetchPageForImport(session, "  https://example.test/recipe  ");
  assert.equal(result.html, page.html);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/v1/import/fetch");
  assert.deepEqual(calls[0].init, { method: "POST", body: { url: "https://example.test/recipe" } });
});

test("an empty page is a failure, not an empty recipe", async () => {
  const session = { async authorized() { return { ...page, html: "" }; } };
  await assert.rejects(
    () => fetchPageForImport(session, "https://example.test/recipe"),
    (err: unknown) => err instanceof AuthApiError && err.code === "unsupported_response",
  );
});

// ---------------------------------------------------------------------------
// What each failure says
// ---------------------------------------------------------------------------

test("every import failure names something the cook can do next", () => {
  const codes = [
    "bad_url", "not_html", "too_large", "blocked", "upstream_timeout",
    "upstream_unreachable", "rate_limited", "unauthorized", "database_unavailable",
    "not_found", "unsupported_response",
  ];
  for (const code of codes) {
    const message = describeImportError(new AuthApiError(400, code, "…"));
    assert.ok(message.title.length > 0, code + " has a title");
    assert.ok(message.detail && message.detail.length > 0, code + " says what to do: " + message.detail);
    assert.ok(!/failed|error|invalid/i.test(message.title), code + " does not just say it failed: " + message.title);
  }
});

test("a blocked site is explained as the site's doing, not the cook's mistake", () => {
  const message = describeImportError(new AuthApiError(422, "blocked", "…"));
  assert.ok(/nothing is wrong with the link/i.test(message.detail ?? ""), message.detail);
  assert.ok(/paste/i.test(message.detail ?? ""), "and offers the way round it");
});

test("being offline never reads as a lost cookbook", () => {
  const message = describeImportError(new AuthNetworkError("down"));
  assert.equal(message.title, "No connection");
  assert.ok(/still work/i.test(message.detail ?? ""), message.detail);
});

test("a bad link is the one failure the cook can fix by retyping", () => {
  const message = describeImportError(new AuthApiError(400, "bad_url", "…"));
  assert.equal(message.tone, "danger");
  assert.ok(/public recipe page/i.test(message.detail ?? ""), message.detail);
});

test("an expired session is recognised as needing a sign-in, and nothing else is", () => {
  for (const code of ["unauthorized", "token_expired", "refresh_invalid"]) {
    assert.equal(needsSignIn(new AuthApiError(401, code, "…")), true, code);
  }
  for (const code of ["blocked", "bad_url", "rate_limited", "too_large"]) {
    assert.equal(needsSignIn(new AuthApiError(422, code, "…")), false, code);
  }
  assert.equal(needsSignIn(new AuthNetworkError("down")), false, "being offline is not an expired session");
});

test("a build with no server says so, rather than blaming the link", () => {
  const message = describeImportError(new AuthApiError(404, "not_found", "…"));
  assert.equal(message.title, "No import server");
  assert.ok(/Writing a recipe out still works/i.test(message.detail ?? ""), message.detail);
});

test("an unrecognised failure is generic rather than alarming", () => {
  assert.equal(describeImportError(new Error("boom")).title, "Something went wrong");
  assert.equal(describeImportError(new AuthApiError(500, "some_future_code", "…")).title, "Something went wrong");
});
