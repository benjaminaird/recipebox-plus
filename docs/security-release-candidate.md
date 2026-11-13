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

---

# Final review, 2026-11-13

Re-verified against `origin/main` at `7d70c20` — **`main` has not moved** since
the candidate was cut, so it is still based on current production.

| Check | Result |
| --- | --- |
| Files changed vs `origin/main` | 3: `server.js`, `scripts/import-reliability-test.js`, `scripts/transaction-test.js` |
| Functions the `server.js` diff touches | `isPrivateIp`, `assertPublicHost`, `isAbortError`, the four auth routes, the `_test` exports, and the new node requires. Nothing else |
| Native / mobile / metric / unfinished content | **none** — searched for `device-auth`, `deviceAuth`, `device_sessions`, `device_tokens`, `api/v1`, `apps/mobile`, `recipe-core`, `volume-metric`, `weight-metric`, `metricDecimal`, `shopping-list`, `recipe_origin`, `createAccount`. The only `sync` matches are the word `async` and two `zlib.*Sync` calls in a test |
| The six fetch commits | Each matches its reviewed source commit by subject: `89d907b`→`04c89a7`, `570f9ee`→`362ada5`, `6db102d`→`4dfb9da`, `a6fa18c`→`0069c9d`, `e44b195`→`23d90d6`, `b490f85`→`d5723ab` |
| The transaction fix | `0ac9870`, hand-applied (it cannot be cherry-picked), plus its test `8edfdb6` |
| Security code identity | **8/8 functions byte-identical** to the feature branch by hash: `isPrivateIp`, `ipv6ToBytes`, `assertPublicHost`, `resolveWithinBudget`, `pinnedFetch`, `safeFetch`, `readBodyCapped`, `withTransaction` |
| 24 suites that exist on `main` | pass |
| Transaction regression, real PostgreSQL 16 | pass; reverting `withTransaction` to the pool fails it |
| SSRF classification | 17 internal addresses private, 5 public addresses public, blocked hostnames and numeric encodings refused, a public literal allowed |
| Prohibited ports | 25 and 6666 blocked, 8080 and 8443 allowed |
| Deadlines | an exhausted budget aborts before connecting (0 ms) |
| Response-body limit | under the cap returns, over the cap returns null |
| DNS | bounded by the remaining budget, capped at 5 s |
| **Legitimate public fetches** | **identical to `main` on 5 real URLs**, including a successful recipe extraction from BBC Good Food and a blocked page that is blocked on both |

## Differences between the candidate and current `main`

Only the three files above. Within `server.js`, the candidate adds
`withTransaction` and converts four route bodies to it; adds `ipv6ToBytes`,
`resolveWithinBudget`, `pinnedFetch` and `BLOCKED_PORTS`; rewrites
`isPrivateIp`'s IPv6 branch numerically; and extends `safeFetch` with the
address pin, the chain deadline and the port check. Nothing in the candidate
differs from the reviewed code on the feature branch except the `_test` export
line, which omits two helpers the candidate does not need.

## Deployment

**One thing to know first:** every push to any branch creates a Vercel Preview
deployment automatically, and previews currently receive the **production**
`DATABASE_URL` (see [preview-environment-safety.md](./preview-environment-safety.md)).
Pushing this branch therefore creates a preview wired to real data. That is
harmless as long as nobody signs in or saves on it, but it is why the branch has
been kept local until you decide.

```sh
# 1. Push the candidate. This creates an SSO-protected preview deployment.
cd /Users/benjaminaird/Projects/recipebox-security-rc
git push -u origin security/release-candidate

# 2. Open the pull request into main.
gh pr create --repo benjaminaird/recipebox-plus --base main \
  --head security/release-candidate \
  --title 'Security: SSRF, fetch deadlines and auth transaction correctness' \
  --body-file - <<'BODY'
Seven reviewed fetch-hardening commits plus the PostgreSQL transaction fix.
Three files: server.js and two test scripts. No schema change, no new
dependency, no new environment variable.

main has no CI, so the suites below were run by hand in the worktree:
24 suites that exist on main, the transaction regression against real
PostgreSQL 16, and a five-URL comparison of /api/fetch-url against main
showing identical behaviour.
BODY

# 3. Before merging, run the suites by hand. main has NO CI.
cd /Users/benjaminaird/Projects/recipebox-security-rc
for f in scripts/*.js; do case "$f" in *import-test*|*nightmare*|*web-preview*|*build-core*|*preview-save*|*smoke-test*|*transaction-test*) continue;; esac; node "$f" >/dev/null || echo "FAILED $f"; done

# 4. And the transaction regression, against a throwaway database.
docker run -d --rm --name rb-release-check -e POSTGRES_PASSWORD=pw \
  -e POSTGRES_DB=rb_release_check -p 55432:5432 postgres:16-alpine
sleep 5
TRANSACTION_TEST_DATABASE_URL=postgres://postgres:pw@localhost:55432/rb_release_check \
  node scripts/transaction-test.js
docker rm -f rb-release-check

# 5. Merge. Vercel deploys production from main automatically.
```

## Post-deployment verification

```sh
# 1. The deployment is live and has its database.
curl -s https://recipebox-kappa.vercel.app/api/health
#    expect {"status":"ok","database":true}

# 2. A legitimate public recipe page still imports. The most important check:
#    the fetch path is what changed most.
curl -s 'https://recipebox-kappa.vercel.app/api/fetch-url?url=https%3A%2F%2Fwww.bbcgoodfood.com%2Frecipes%2Fclassic-scones-jam-clotted-cream' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('title:',j.title,'| recipe:',!!j.recipe,'| via:',j.via);});"
#    expect a title, recipe true, via "direct"

# 3. An internal address is refused, and quickly.
time curl -s -o /dev/null -w '%{http_code}\n' \
  'https://recipebox-kappa.vercel.app/api/fetch-url?url=http%3A%2F%2F%5B%3A%3Affff%3A7f00%3A1%5D%2F'
#    expect 400, in well under a second

# 4. A prohibited port is refused.
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://recipebox-kappa.vercel.app/api/fetch-url?url=http%3A%2F%2Fexample.com%3A25%2F'
#    expect 400

# 5. The security headers are unchanged.
curl -sI https://recipebox-kappa.vercel.app/ | grep -iE 'x-frame-options|strict-transport|x-content-type'

# 6. Then, in the browser, with a real account: sign in, change the password,
#    and confirm the other sessions are signed out and the new password works.
#    This is the transaction fix's user-visible path.
```

Watch the function logs for an increased rate of `AbortError`. A small rise is
expected — slow fetches now fail sooner on purpose. A large one would mean the
budget is too tight for real sites.

## Rollback

**The release needs no database rollback, because it changes no database.** No
table, no column, no index, no migration, no data written in a new shape. That
is the main thing to understand about rolling it back: only code moves.

```sh
# Revert the merge commit and let Vercel deploy the revert from main.
gh pr view <number> --repo benjaminaird/recipebox-plus --json mergeCommit
git revert -m 1 <merge-commit-sha>
git push origin main
```

Or, faster and without touching git: in the Vercel dashboard, promote the
previous production deployment (`main` at `7d70c20`) — **Deployments → the
earlier production deployment → Promote to Production**. That is the quickest
path and the one to use if an import outage is in progress.

### Database backup, as far as this session can establish it

- The database is **Neon project `recipebox-db` (`polished-bonus-69833220`)**,
  with **exactly one branch, `main`**, marked by the Vercel integration as the
  production branch. There are no preview branches.
- Neon provides **point-in-time restore** by creating a branch from a timestamp,
  which is the mechanism a recovery would use. **The retention window for this
  project has not been read in this session**, and it is plan-dependent — on
  the free tier it is short. **Confirm it in the Neon dashboard before relying
  on it.**
- No scheduled logical dump (`pg_dump`) is configured anywhere in this
  repository, and nothing in the deploy path takes one.

Because this release writes nothing new and changes no schema, none of that is
on its critical path. It is listed because "the backup procedure is understood"
should mean understood, and the honest statement is: **PITR via Neon branching
is the recovery mechanism, its retention window is unverified, and there is no
independent dump.** Taking one before any future schema change — the sync
migration especially — would be worth doing.
