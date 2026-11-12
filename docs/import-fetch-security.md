---
status: review — no code written
date: 2026-11-11
---

# Security requirements for `POST /api/v1/import/fetch`

The contract is in [native-import-contract.md](./native-import-contract.md): an
authenticated endpoint that takes a URL, fetches it server-side, and returns the
raw HTML for the device to extract on-device per ADR 0007. This document reviews
what that needs to be safe, and what already exists.

**The endpoint is not implemented.** No route was added. One finding below was
a defect in code that is **already live**; it was approved separately and
**is now fixed** — see finding 1.

## The short version

An authenticated endpoint that fetches an arbitrary user-supplied URL is an
open proxy and an SSRF primitive. RecipeBox already has one — `/api/fetch-url`,
used by the web importer — and it is already defended by `safeFetch`,
`assertPublicHost`, `isPrivateIp`, `readBodyCapped`, `fetchWithTimeout` and a
DB-backed rate limiter. **The new endpoint must reuse all of it and add
nothing.** A second fetch path with its own idea of what a private address is
would be the same mistake the native shopping list had made about measurement
units, with a worse failure mode.

Three things needed to change or be decided first. They are ordered by
severity; the first is now fixed, the other two are open.

## 1. `isPrivateIp` judged IPv6 by its spelling — fixed

**Status: fixed in `server.js`.** Approved as a security fix on its own, ahead
of the endpoint. Keeping the detail because the shape of the bug is the useful
part.

The IPv6 branch compared strings:

```js
if (lower === '::1' || lower === '::') return true;
if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
const mapped = lower.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
if (mapped) return isPrivateIp(mapped[1]);
```

Every line of that is a *spelling* of a range rather than the range. An IPv6
address has many legal spellings of the same 16 bytes, and `new URL()`
normalises almost none of them away. **Seventeen addresses that must never be
fetched were judged public, sixteen of them reachable through a URL:**

| spelling | what it actually is | why it slipped through |
| --- | --- | --- |
| `::ffff:7f00:1` | 127.0.0.1 | the regex wanted a *dotted* quad |
| `::ffff:a9fe:a9fe` | 169.254.169.254, cloud metadata | same |
| `::ffff:0a00:1`, `::ffff:ac1f:1`, `::ffff:c0a8:1`, `::ffff:6440:1` | 10.0.0.1, 172.31.0.1, 192.168.0.1, 100.64.0.1 | same |
| `::7f00:1`, `::127.0.0.1`, `::a9fe:a9fe` | loopback and metadata via the deprecated IPv4-**compatible** `::/96` | no branch covered that prefix at all |
| `64:ff9b::7f00:1` | loopback via the NAT64 well-known prefix | not covered |
| `2002:7f00:1::1` | loopback via 6to4, which carries IPv4 in bytes 2–5 | not covered |
| `febf::1`, `fe9a::1` | link-local — `fe80::/10` is **ten** bits, so `fe80`–`febf` | `startsWith('fe80')` saw only the first of 64 |
| `ff02::1`, `ff00::1` | multicast | the IPv4 branch blocked `>= 224`; the IPv6 branch had no equivalent |
| `0:0:0:0:0:0:0:1` | loopback, uncompressed | the only one **not** exploitable: `new URL()` compresses it to `[::1]` |

It was confirmed end to end, not inferred. A local server on 127.0.0.1 served a
known string; `http://[::ffff:7f00:1]:<port>/` passed `assertPublicHost` and
returned that string, while `127.0.0.1` and `[::1]` were refused at the guard.
`/api/fetch-url` uses this guard, so it was live.

### The fix

Not another spelling. A new `ipv6ToBytes()` expands any IPv6 literal to its 16
bytes — compressed, uncompressed, mixed case, trailing dotted quad, zone index
— and `isPrivateIp` then compares **numbers**:

- `::/128` and `::1/128`
- `::ffff:0:0/96` and `::/96`: an IPv4 address in disguise, so the IPv4 rules
  decide it, in either spelling
- `2002::/16`: 6to4, judged by the IPv4 address in bytes 2–5
- `64:ff9b::/32` and `2001::/32`: NAT64 and Teredo, prefixes that exist only to
  reach somewhere else and on which no recipe site is hosted — refused outright
- `fe80::/10` by mask, `fc00::/7`, `ff00::/8`

A spelling check on IPv6 will keep producing findings like this one. A numeric
one cannot have that class of bug, which is the actual repair.

### Evidence

All seventeen addresses are now blocked, and nothing legitimate was lost:

- The end-to-end probe was re-run across eight spellings of 127.0.0.1
  (`::ffff:7f00:1`, `::7f00:1`, `64:ff9b::7f00:1`, `2002:7f00:1::1` among
  them). **Every one refused at the guard; none reached the service.**
- Ten real recipe and reference hosts still resolve and pass, and ten real
  public IPv6 addresses — including Google's `2001:4860:4828:7700::`, which
  sits next to the Teredo prefix now refused — are still allowed. A guard that
  blocks everything is not a guard, it is an outage.
- `scripts/import-reliability-test.js` now covers all of it: every blocked
  spelling with the reason, public addresses that must stay allowed, malformed
  input that must neither match a range nor throw, and `ipv6ToBytes` itself
  asserting that the dotted and hex spellings of one address expand to the same
  bytes. The suite's original eleven-address list is kept — it is exactly the
  set of spellings the old code got right, which is why the holes survived.

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
| Private address blocking | `assertPublicHost` + `isPrivateIp`: IPv4 loopback, `10/8`, `127/8`, `169.254/16`, `172.16–31`, `192.168/16`, CGNAT `100.64/10`, multicast and reserved `224+`; IPv6 judged numerically per finding 1 | reuse as is |
| Obfuscated host forms | `assertPublicHost` refuses decimal, hex and octal-label encodings before they reach DNS, so `getaddrinfo` cannot interpret them differently from the check | reuse as is |
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

1. ~~Fix finding 1 in `isPrivateIp`.~~ **Done** — it was live, so it went in on
   its own rather than waiting for the endpoint.
2. Build `/api/v1` + device token auth (ADR 0010). **This is the blocker.**
3. Add the endpoint, reusing every mechanism in the table above and adding
   none.
4. Decide the DNS-pinning question in finding 2 before it is a production
   incident rather than after.

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
