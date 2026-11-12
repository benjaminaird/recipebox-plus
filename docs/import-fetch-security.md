---
status: review — no code written
date: 2026-11-11
---

# Security requirements for `POST /api/v1/import/fetch`

The contract is in [native-import-contract.md](./native-import-contract.md): an
authenticated endpoint that takes a URL, fetches it server-side, and returns the
raw HTML for the device to extract on-device per ADR 0007. This document reviews
what that needs to be safe, and what already exists.

**Nothing here is implemented.** No endpoint was added and `server.js` is
unchanged. One finding below is a defect in code that is **already live**, and
it is the reason this review exists rather than an implementation.

## The short version

An authenticated endpoint that fetches an arbitrary user-supplied URL is an
open proxy and an SSRF primitive. RecipeBox already has one — `/api/fetch-url`,
used by the web importer — and it is already defended by `safeFetch`,
`assertPublicHost`, `isPrivateIp`, `readBodyCapped`, `fetchWithTimeout` and a
DB-backed rate limiter. **The new endpoint must reuse all of it and add
nothing.** A second fetch path with its own idea of what a private address is
would be the same mistake the native shopping list had made about measurement
units, with a worse failure mode.

Three things must change or be decided first. They are ordered by severity.

## 1. `isPrivateIp` does not catch hex-form IPv4-mapped IPv6 — live, exploitable

`isPrivateIp` (`server.js:1973`) recognises an IPv4-mapped IPv6 address only in
its **dotted** spelling, via

```js
const mapped = lower.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
```

The same addresses have an equivalent **hex** spelling, which that pattern does
not match and which no other branch catches. `::ffff:7f00:1` *is* 127.0.0.1.

What the WHATWG URL parser normalises matters here, and it does not normalise
this. `new URL("http://[0:0:0:0:0:0:0:1]/").hostname` comes back as `[::1]`, so
the uncompressed loopback spelling is blocked by the `=== '::1'` check. But
`new URL("http://[::ffff:7f00:1]/").hostname` stays `[::ffff:7f00:1]`, so the
hex form reaches `isPrivateIp` as written and is judged public.

Measured against the live code, not inferred:

| host | what it is | `isPrivateIp` | reachable by URL |
| --- | --- | --- | --- |
| `127.0.0.1` | loopback | blocked | — |
| `::1` | loopback | blocked | — |
| `::ffff:127.0.0.1` | loopback, dotted | blocked | — |
| `2130706433`, `0x7f000001` | loopback, obfuscated | blocked | — |
| **`::ffff:7f00:1`** | **loopback** | **allowed** | **yes** |
| **`::ffff:a9fe:a9fe`** | **169.254.169.254, cloud metadata** | **allowed** | **yes** |
| **`::ffff:0a00:0001`** | **10.0.0.1** | **allowed** | **yes** |
| `0:0:0:0:0:0:0:1` | loopback, uncompressed | allowed | no — URL normalises it to `::1` |

The bypass was confirmed end to end, not just as a failed predicate: a local
HTTP server was started on 127.0.0.1 serving a known string, and
`http://[::ffff:7f00:1]:<port>/` passed `assertPublicHost` and then returned
that string through `fetch`. `127.0.0.1` and `[::1]` were refused at the guard,
as they should be.

**Impact.** `169.254.169.254` is the cloud instance metadata service. On a
platform that serves credentials there, an SSRF that reaches it is a credential
disclosure, and the response body of this endpoint is returned to the caller
verbatim as `html`. That makes the proposed endpoint a materially worse place
for this bug than `/api/fetch-url`, which post-processes into a recipe shape.

**Fix.** Normalise before judging rather than pattern-matching a spelling.
Convert any IPv4-mapped IPv6 address to its dotted form and re-test, instead of
only recognising addresses already written that way:

```js
// Any ::ffff:0:0/96 address is an IPv4 address wearing IPv6 clothes, in either
// spelling: ::ffff:127.0.0.1 and ::ffff:7f00:1 are the same host.
const hextets = lower.split(":");
const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
if (mappedHex) {
  const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
  return isPrivateIp([hi >> 8, hi & 255, lo >> 8, lo & 255].join("."));
}
```

That snippet was checked against the live function rather than written and
left: wrapped around `isPrivateIp`, it newly blocks `::ffff:7f00:1`,
`::ffff:a9fe:a9fe`, `::ffff:0a00:0001`, `::ffff:ac10:0001` and
`::ffff:c0a8:0001`, still allows the public `::ffff:5db8:d822`
(93.184.216.34), and changes no verdict for the dotted, plain-IPv4 or
native-IPv6 cases.

A stronger version, and the one worth writing, drops spelling entirely:
expand the address to its 16 bytes once, then test ranges numerically. Spelling
checks on IPv6 will keep producing findings like this one; a numeric test will
not.

**This is a fix to live production code.** It was not made here. `CLAUDE.md`
holds the web app's behaviour fixed until a change is explicitly approved, and
`/api/fetch-url` is on a page real users use today. It is a security fix rather
than a behaviour change, so it probably deserves to go in on its own, ahead of
the endpoint and separately from it — but that is a call to make, not one to
take. **The endpoint must not ship before it.**

## 2. The guard resolves DNS, then `fetch` resolves it again

`assertPublicHost` calls `dns.lookup` and checks the addresses; `safeFetch` then
calls `fetch(current)`, which resolves the name **again**, independently. The
two resolutions can differ. A name whose record has a very short TTL, under the
attacker's control, can answer with a public address for the check and a private
one for the connection.

This is the standard DNS-rebinding bypass and no amount of care in
`assertPublicHost` closes it, because the check and the connection are two
separate resolutions of the same name.

**Mitigation.** Resolve once and connect to the address, not the name: pin the
validated IP and pass it to a custom undici `lookup`, or dial the IP with the
original `Host` header and SNI preserved. Node's `fetch` accepts a `dispatcher`
with a `connect.lookup` option, which is the least invasive place to put it.

**Recommendation.** Not a blocker for a first version, but it must be recorded
as a known residual risk rather than discovered later. It is listed second
because finding 1 needs no DNS trickery at all.

## 3. The redirect timeout is per hop, and the function has 60 seconds

`safeFetch` allows `maxRedirects = 5` and gives **each** hop
`timeoutMs = 9000`. Six hops that each stall gives 54 seconds inside a function
whose `vercel.json` `maxDuration` is **60**. A slow chain therefore runs the
function to its limit rather than returning a clean error.

**Fix.** Budget the whole fetch, not each hop: take a deadline once and pass the
remaining time to each hop, so the total cannot exceed it. This is excluded from
the finding list as a DoS concern, but it is a correctness bug at the contract
level — the endpoint owes the device a `422` or a timeout it can act on, not a
dead function.

## What already exists and should simply be reused

| Need | Existing mechanism | Verdict |
| --- | --- | --- |
| Protocol allow-list | `safeFetch` refuses anything but `http:`/`https:` | reuse as is |
| Private address blocking | `assertPublicHost` + `isPrivateIp`: loopback, `10/8`, `127/8`, `169.254/16`, `172.16–31`, `192.168/16`, CGNAT `100.64/10`, multicast and reserved `224+`, IPv6 `::1`, `fe80`, `fc`/`fd` | reuse **after finding 1** |
| Obfuscated host forms | `assertPublicHost` refuses decimal, hex and octal-label encodings before they reach DNS, so `getaddrinfo` cannot interpret them differently from the check | reuse as is — this is the right shape, and finding 1 is the one spelling it misses |
| Name-based internal hosts | `localhost`, `*.localhost`, `*.internal`, `*.local` refused | reuse as is |
| Redirects | `redirect: 'manual'`, every hop re-validated before it is followed, capped at 5 | reuse; fix the budget per finding 3 |
| Response size | `readBodyCapped`, streaming, honours `content-length`, cancels the body, default 6 MB | reuse with a **smaller** cap — see below |
| Timeouts | `fetchWithTimeout`, `AbortController`, 9 s default | reuse; fix the budget per finding 3 |
| Rate limiting | `checkRateLimit(key, bucket, max, scope)`, DB-backed in `rate_limit_counters`, already used per-IP, per-user and as a burst bucket on the AI routes | reuse; see below |
| Blocked-page detection | `looksBlockedPage`, and the scraper fallback with `IMPORT_PROXY_DAILY_CAP` | reuse as is |

### Response size needs its own, smaller cap

Three different limits are in play and should not be confused. `server.js` caps
extracted **text** at 18 000 characters; `readBodyCapped` caps a fetched **body**
at 6 MB; the contract returns the **raw HTML inside a JSON response**.

6 MB of HTML, JSON-escaped, is a multi-megabyte response to a phone on mobile
data for what is meant to be one recipe. Recipe pages are tens of kilobytes.
Cap the HTML this endpoint will return at something like **2 MB**, reject above
it with the contract's `422 not-html` or a new `422 too-large`, and say so in
the contract so the client can show something truthful.

### Rate limiting: the shape, not just the number

The limiter exists, so this is a question of keys and buckets, not of building
anything:

- **Per device token**, so one compromised token cannot drive the fetcher.
- **Per account**, because tokens are cheap if token issuance is.
- **A burst bucket** as well as a daily one — the AI routes already do exactly
  this, and the pattern transfers.
- **Per target host** is worth considering: it is what stops the endpoint being
  used to hammer a third party, which is the open-proxy concern rather than the
  SSRF one.
- Note that `checkRateLimit` **fails open** when there is no database
  (`if (!db) return { allowed: true, ... }`). That is the right call for
  sign-in; for a fetching endpoint, decide deliberately whether no-database
  means unlimited fetching or no fetching.

## The hard prerequisite: there is no `/api/v1` and no device token

ADR 0010 specifies a versioned API with token auth for the native client.
Neither exists: `server.js` has no `/api/v1` route and no device-token
verification. The contract's `Authorization: Bearer <device token>` has nothing
behind it today.

So the endpoint cannot be built as specified without first building token auth —
which is a larger, separate piece of work with its own security surface
(issuance, storage on device, revocation, rotation, scope). Shipping the fetch
endpoint on cookie auth instead, to avoid that, would contradict ADR 0010 and
put a fetching endpoint on the web app's session cookies.

**Therefore: implementation is blocked, and not by caution.** The ordering is

1. Fix finding 1 in `isPrivateIp`, with tests for both spellings.
2. Build `/api/v1` + device token auth (ADR 0010).
3. Add the endpoint, reusing every mechanism in the table above.
4. Decide the DNS-pinning question in finding 2 before it is a production
   incident rather than after.

Step 1 is worth doing on its own, now, because it is live.

## Appendix: the `build-core.js` guard, and whether it wants a parser

Asked separately, and recorded here because it is the same question of how much
a regex can be trusted.

`scripts/build-core.js` refuses any `require()` inside `packages/recipe-core`
that does not resolve to one of the eight sibling modules, and refuses top-level
`import`/`export`. It scans source **text**. A review of commit `8a303a8` found
one evasion: `isCommentLine` judged only the text before a match, so a comment
opened **and closed** before it — `/**/require("../../node_modules/evil")` —
was treated as a comment and never judged. That is fixed; the guard now requires
the comment to still be open at the match, and the case is one of seven negative
probes.

**It is still a regex over text, and it should not be mistaken for an audit.**
A known remaining limit: a block comment whose continuation lines do not begin
with `*` is read as code, which can produce a false positive on the
`import`/`export` check. No regex fixes that; only tracking comment state does.

**A parser is the obvious answer and is not available here.** The guard runs in
the CI job that installs **nothing** — that is precisely how the package's
dependency-free contract is enforced rather than asserted — so it cannot import
a parser. Node ships no public JavaScript parser API, and adding one as a
devDependency would mean the job that proves the package needs no dependencies
would itself need one.

**The better option needs no parser.** Load each module in a `vm` context with a
`require` that records its argument and throws on anything that is not a
sibling. That is a semantic check rather than a textual one: immune to comments,
string spelling and formatting, and it catches a computed specifier by its
actual value. It uses only `vm` and `module` from the standard library, and these
modules call `require` at load time, so one load sees every specifier that
matters. Its limit is the mirror of the regex's: it sees only what executes.

Recorded as the option, not taken. It replaces a working check with a different
one and belongs in its own change, with its own negative probes, rather than
inside a measurement fix.
