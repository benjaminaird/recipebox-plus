---
status: proposed — verified locally, NOT executed
date: 2026-11-12
---

# Releasing the fetch-security fixes without the native app or the metric change

The SSRF and fetch-hardening fixes are on `feature/recipebox-2.0`. They are not
in production. That branch also carries work that is **not** ready to ship: the
native client, and a deliberate change to what web users see on the shopping
list.

So the security fixes need a release path of their own. This is that path,
verified locally. **Nothing here has been executed, and nothing should be
without explicit authorisation.**

## What is and is not releasable

| Commit | What it is | Ship now? |
| --- | --- | --- |
| `04c89a7` | `isPrivateIp` judges IPv6 numerically — seventeen internal addresses were judged public | **yes** |
| `362ada5` | DNS pinning, and one deadline for the whole redirect chain | **yes** |
| `4dfb9da` | The deadline covers reading the body | **yes** |
| `0069c9d` | The controlled DNS-rebinding test | **yes** (test only) |
| `23d90d6` | An unusable HTTP status no longer crashes the fetcher; WHATWG bad ports refused again | **yes** |
| `e78fc31` | Metric corrections | **no** — changes what web users see; approved for the branch, not for release |
| `1c22098` | `packages/recipe-core` extraction | **no** — not needed by the fixes, and it moves every domain module |
| `8a303a8`, `239ea76` | The dependency-free build guard | **no** — `scripts/build-core.js` only exists because of the extraction |
| everything in `apps/mobile` | The native client | **no** |

The five releasable commits touch **`server.js` and
`scripts/import-reliability-test.js` and nothing else**. They do not depend on
the extraction: the hunks live in `isPrivateIp` / `pinnedFetch` / `safeFetch`
and in the `_test` export list, none of which the extraction touched.

## The recommended path: cherry-pick the five onto `main`

A branch off `main`, the five commits cherry-picked **code only**, a pull
request, then the normal deploy. Not a merge of `feature/recipebox-2.0`, which
would drag the metric change and the native app into production.

```bash
git fetch origin
git switch -c security/fetch-hardening origin/main

# Code only. Each commit also touched branch-only docs, which do not exist on
# main and will conflict; resolve by dropping them.
for c in 04c89a7 362ada5 4dfb9da 0069c9d 23d90d6; do
  git cherry-pick -n "$c" || true
  for f in $(git diff --name-only --diff-filter=U); do git rm -q -f "$f"; done
  git commit -C "$c"
done

git diff --name-only origin/main   # must list exactly server.js and scripts/import-reliability-test.js
```

Then the suites, and a pull request into `main`.

### Verified, not assumed

The above was run locally in a throwaway worktree (branch
`release-ssrf-verify`, never pushed, since deleted):

- **All five applied**, `server.js` auto-merging with no conflict. The only
  conflicts were the branch-only documents, which are dropped.
- **Exactly two files differ from `main`**: `server.js` and
  `scripts/import-reliability-test.js`.
- **`public/shopping-list.js` is byte-identical to `main`** — the metric change
  does not leak into this release. `apps/mobile` is absent.
- **The candidate's `server.js` differs from the branch's by six lines**, which
  are the three `packages/recipe-core` require paths. Nothing else: the
  security code is the same code.
- **Eighteen regression suites pass** on the candidate, including
  `import-reliability` (which carries the new SSRF, rebinding, deadline and
  port tests), `security-hardening`, `security-headers`, `request-guards`,
  `auth-rate-limit`, `auth-verification` and `recipe-persistence`.
- **The fixes are live in the candidate**: `[::ffff:7f00:1]`,
  `[::ffff:a9fe:a9fe]`, `[::7f00:1]`, `[febf::1]` and `[ff02::1]` all refused,
  the blocked-port list present, `pinnedFetch` in place.

### Two tools are branch-only

`scripts/web-preview-check.js` and `scripts/build-core.js` do not exist on
`main` — both arrived with the extraction. So the release candidate cannot run
`web-preview-check`. `main` has its own `smoke-test` and `security-smoke-test`
npm scripts, which is what to run against a deploy preview instead. Worth
knowing before someone reports the command missing and assumes something is
wrong.

## What a reviewer should check

- The diff is two files.
- `git diff origin/main -- public/ src/ apps/` is empty.
- `/api/fetch-url` still imports a recipe. The evidence from the branch: the
  live route was run against ten URLs on the branch and on `main`, and the
  output is identical for every one — JSON-LD extraction, an `http`→`https`
  redirect, a three-hop chain, and bot-blocked sites failing the same way.
- The deploy preview answers, and `BASE_URL=<preview> npm run smoke-test` and
  `security-smoke-test` pass.

## Behaviour changes a release carries

These are intended, and each is a destination that should never have been
reachable — but they are changes, and someone will ask:

1. **Some URLs that previously fetched now fail.** Any URL resolving to an
   internal address through an IPv6 spelling the old guard missed now returns
   400. In production that should be nobody's recipe.
2. **Non-standard ports are refused.** A URL on SMTP, IRC, NFS or an X server
   port returns 400. Ports like 8080 and 8443 still work.
3. **A slow fetch fails sooner.** The whole fetch is bounded at 20 seconds
   rather than up to 54, and the body is now inside that bound. A page that
   took 30 seconds to dribble its HTML used to arrive and now returns 504.
   The route already had that 504 and a message pointing at Paste Text.
4. **No change to the shopping list, the recipe card, or anything a cook sees**
   on a page that imports normally. That is the point of releasing this set and
   not the branch.

## Rollback

Revert the pull request. The change is confined to `server.js`, adds no table,
no column, no environment variable and no dependency, so a revert is complete
and instant. There is no migration to undo and no data written in a new shape.

## Not covered by this plan

- **The service-worker `VERSION` bump** in `public/sw.js`. Not needed here —
  this release changes no file the service worker caches. It *is* needed
  whenever the metric change ships, and
  [ADR 0021](./adr/0021-metric-and-us-customary-are-separate.md) records that.
- **`dns.lookup` has no timeout.** One hanging resolution can still overrun the
  budget; bounding it needs a resolver with its own timeout. Recorded in
  [import-fetch-security.md](./import-fetch-security.md) and unchanged by this
  release.
- **The metric change and the native client**, which need their own release
  decisions and, for the native client, a build that is not being made yet.
