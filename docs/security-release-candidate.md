---
status: built and verified — NOT pushed, NOT deployed
date: 2026-11-13
---

# The security release candidate

[security-release-plan.md](./security-release-plan.md) is the plan. This is the
thing itself: a branch that exists, with the tests that were run against it and
what it would take to ship it.

**Nothing has been pushed or deployed.** The branch is local.

| | |
| --- | --- |
| Branch | `security/release-candidate` |
| Worktree | `/Users/benjaminaird/Projects/recipebox-security-rc` |
| Base | `origin/main` (`7d70c20`) |
| Commits | 8 |
| Files changed | **3** |

```
server.js
scripts/import-reliability-test.js
scripts/transaction-test.js      (new)
```

## What is in it

| Area | Commit on the candidate |
| --- | --- |
| SSRF address classification, IPv6 judged by bytes | `89d907b` |
| DNS-rebinding protection, connection pinned to the judged address | `570f9ee` |
| Fetch deadline covering the whole chain | `570f9ee` |
| The deadline covering response-body reading | `6db102d` |
| The controlled rebinding test, with a negative control | `a6fa18c` |
| HTTP status crash, and the WHATWG prohibited-port list | `e44b195` |
| The deadline covering DNS; suites that stop halfway now fail | `b490f85` |
| PostgreSQL transaction handling for the four affected routes | `0ac9870` |
| The transaction regression test | `8edfdb6` |

The first seven are cherry-picks of the reviewed commits, code only. The eighth
could not be picked — two of its four blocks were also edited on the feature
branch to revoke native device sessions — so the same change was applied to
`main`'s own versions of the four routes by hand.

## What is deliberately not in it

Verified by searching the whole candidate diff: no occurrence of `device-auth`,
`deviceAuth`, `device_sessions`, `api/v1`, `apps/mobile`, `recipe-core`,
`volume-metric`, `weight-metric`, `metricDecimal` or `shopping-list`.

So: no native authentication routes, no native application code, no shared-core
metric change, no new product feature, no refactor that is not the fix.

## Evidence

- **The security code is the reviewed code.** Eight functions — `isPrivateIp`,
  `ipv6ToBytes`, `assertPublicHost`, `resolveWithinBudget`, `pinnedFetch`,
  `safeFetch`, `readBodyCapped`, `withTransaction` — are **byte-identical** to
  the feature branch's, compared by hash. The candidate is not a re-typing of
  the fixes.
- **Every fix is live**, asserted by loading the candidate's own module:
  `::ffff:7f00:1`, `::ffff:a9fe:a9fe`, `::7f00:1` and `febf::1` all judged
  private, a real public IPv6 not, port 6666 blocked and 8080 not, and
  `pinnedFetch`, `resolveWithinBudget` and `withTransaction` all present.
- **24 of 24 suites that exist on `main` pass** in the candidate.
- **`transaction-test.js` passes against real PostgreSQL 16** in a throwaway
  container, and **reverting `withTransaction` to the pool fails it**.
- **`smoke-test` and `security-smoke-test` pass** against the candidate running
  on an ephemeral port with no database (5 of 5 security checks `ok`).
- `transaction-test.js` **skips cleanly with no database**, so it is safe in
  any environment that cannot provide one.

### What the transaction test proves

Both directions of the guarantee, and then the three routes that can lose
something.

With `withTransaction`: a transaction keeps one backend from start to finish;
two overlapping ones use *different* backends, so they genuinely raced; and
nothing survives either rollback.

Without it, modelled exactly rather than waited for — hold one client so the
pool must serve the next query from another backend, and the row written after
`BEGIN` survives the `ROLLBACK`.

Then: **account deletion** with a table broken after the recipes are deleted —
the recipes have to come back, and they do. **Password change** asserted
through sign-in rather than by reading a hash. **Email verification** asserting
the token was not consumed, because a spent token against an unverified account
leaves somebody unable to confirm.

## Deployment prerequisites

Short, because the change is small.

- **No new environment variable, dependency, table, column or migration.**
- **No `vercel.json` change.** `maxDuration` stays 60.
- **No service-worker `VERSION` bump.** This release changes no file the
  service worker caches. (A bump *is* needed whenever the metric change ships —
  [ADR 0021](./adr/0021-metric-and-us-customary-are-separate.md) — and that is
  not this.)
- **`main` has no CI.** `.github/workflows/ci.yml` exists only on the feature
  branch, so opening a pull request into `main` runs nothing automatically. The
  suites above have to be run by hand, in the worktree, before merging. This is
  the easiest prerequisite to forget.
- Releasing means pushing `security/release-candidate` and opening a pull
  request into `main`; Vercel deploys production from `main` on merge.

## Verifying it in production

In order, after the deploy:

1. `GET /api/health` returns `{"status":"ok","database":true}`.
2. Import a normal recipe URL through the app. This is the single most
   important check: the fetch path is what changed most.
3. Import a URL on a non-standard-but-legitimate port (`:8443`) if one is to
   hand — it must still work.
4. Confirm a URL that resolves to an internal address is refused with a 400,
   not a hang.
5. Sign in on the web, change the password, confirm the other sessions are
   signed out and the new password works.
6. Watch the function logs for `AbortError` at a higher rate than before. A
   small increase is expected — slow fetches now fail sooner on purpose — and
   a large one would mean the budget is too tight for real sites.

## Rollback

Revert the pull request. The change is confined to `server.js` and two test
files; it adds no table, no column, no environment variable and no dependency,
so a revert is complete and immediate. Nothing is written in a new shape, so
there is no data to migrate back.

## Remaining operational risks

1. **Some URLs that used to fetch will now fail.** Intended, and each is a
   destination that should never have been reachable: an internal address
   reached through an IPv6 spelling, a prohibited port, a page that takes more
   than the budget to arrive. In production none of these should be anybody's
   recipe, but it is a behaviour change and someone may notice.
2. **A name that will not resolve fails after five seconds** rather than
   holding the request to the function limit. Healthy resolvers are far under
   that.
3. **`dns.lookup` still cannot be cancelled.** The wait is bounded; the lookup
   itself continues in libuv's threadpool until it gives up, holding a slot.
   Its answer is discarded, so this is a resource matter and not a security
   gap — see [import-fetch-security.md](./import-fetch-security.md).
4. **The transaction fix holds a pooled client for the duration of each auth
   transaction.** The pool is pg's default of ten per instance and these
   transactions are short, so this should be invisible; it is named because it
   is the one way the change alters resource behaviour rather than just
   correctness.
5. **No CI on `main`** (above). Nothing will catch a mistake in the merge
   except a person.

## The decision this still needs

Pushing the branch and opening the pull request has not been done, because
doing so starts the path to production. **It needs explicit approval**, and so
does the merge.
