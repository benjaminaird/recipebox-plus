# Native import: what is reused, and the one endpoint still needed

Status: **the parsing half is implemented and tested; the fetching half is a
proposal and is not built.** Written because the brief asked for safe
integration where it is achievable and a documented contract where it is not.

## What the native app already reuses, unmodified

`public/recipe-extract.js`, `public/recipe-normalize.js` and
`public/recipe-grounding.js` are **pure** — their own headers say "no
DOM/network/AI" — and `server.js` already treats HTML-to-recipe as a pure
function (`buildPageResult`, commented "so it can … be unit-tested offline").

So the native app loads those files themselves, through Metro `watchFolders`,
behind one typed boundary (`src/domain/webImport.ts`). There is **no second
importer**, which the brief forbids and which would be the real risk here: two
readings of one page that disagree, with nothing to say which is right.

`test/import-review.test.ts` runs the real extractor over stored HTML and
asserts the output shape, so a change in production's extractor fails the
native tests rather than silently diverging.

What this gives, today, with no backend change:

- Structured-data extraction (JSON-LD and microdata) and the heuristic fallback.
- Original measurements preserved exactly as written, including the `raw` line.
- Grounding: which ingredients appear in the page text, a confidence figure,
  and which distinctive terms were dropped.
- A field-by-field account of what the page did and did not provide.

## What still needs the server, and why it is not done on the phone

Fetching the page. Three reasons, none of them cosmetic:

1. **Sites block unknown clients.** `server.js` falls back to a scraping proxy
   for exactly this, with its own key. A phone fetching directly would simply
   fail on the sites that most need the fallback — and fail *silently*, looking
   like a bad recipe rather than a blocked request.
2. **Privacy.** A direct fetch puts the cook's IP address on every recipe site
   they import from. The server fetch does not.
3. **It is where the rest of the pipeline lives.** The response is hashed
   (`htmlHash`) and the AI-assisted path (ADRs 0016, 0017) hangs off the same
   route. A native path that skipped them would be the separate importer the
   brief rules out.

## Proposed contract

A new endpoint under `/api/v1` with token auth, per ADR 0010, which leaves the
web app's cookie-authenticated routes untouched.

```
POST /api/v1/import/fetch
Authorization: Bearer <device token>
{ "url": "https://example.com/recipe" }

200 {
  "finalUrl":        "https://example.com/recipe",   // after redirects
  "html":            "<!doctype html>…",             // RAW, including ld+json
  "htmlHash":        "sha256:…",
  "blocked":         false,
  "fetchedAt":       1762800000000,
  "via":             "direct" | "proxy"
}

422 { "error": "blocked",  "message": "…" }   // page refused us
422 { "error": "not-html", "message": "…" }
429 { "error": "rate-limited", "retryAfter": 30 }
```

**It returns HTML, not a recipe.** That is the important part of the shape: the
extraction then runs on the device, which keeps one implementation of the thing
that decides what a recipe says, keeps the deterministic-first promise of
ADR 0007, and means an import works from cache with no second round trip.

### Why this is not built here

It is a new production endpoint. That is a backend change with production
implications, and the brief says to document the contract and continue. It also
needs decisions that are not mine:

- **Rate limiting and abuse.** An authenticated endpoint that fetches arbitrary
  URLs on request is an open proxy unless it is bounded.
- **SSRF.** It must refuse private address ranges and loopback, or it becomes a
  way to reach the inside of the network.
- **Response size.** `server.js` caps readable text at 18 000 characters; a raw
  HTML response needs its own cap.
- **Whether the device token from ADR 0010 exists yet.**

Those four are now reviewed in detail, with what already exists and what must
change first, in
[import-fetch-security.md](./import-fetch-security.md). The short version:
`server.js` already has the whole defensive apparatus and the endpoint should
reuse it rather than add any, but **the review found a live SSRF bypass in the
shared `isPrivateIp` guard** (hex-form IPv4-mapped IPv6, e.g. `::ffff:7f00:1`
for 127.0.0.1, confirmed reaching a service on loopback), and there is still no
`/api/v1` and no device-token verification. Both block implementation.

## Smaller, safe alternative if the above is too much

The native app could accept **pasted HTML or pasted recipe text** and run the
same pipeline with no new endpoint at all. ADR 0007 already makes pasted text a
deterministic on-device path, so this is in the accepted direction and needs no
server work. It is a worse experience than pasting a link and it is
considerably cheaper; it is recorded here as the fallback rather than chosen
unilaterally.

## Not proposed

Fetching from the device. Writing a native-only extractor. Changing anything in
`public/`, `server.js` or the production schema.
