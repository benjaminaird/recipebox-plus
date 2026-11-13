---
status: proposed — nothing provisioned, nothing started
date: 2026-11-13
---

# A backend the iPhone can reach, safely

The native app needs `/api/v1` reachable from a physical phone over HTTPS, with
isolated accounts and isolated data, without touching production and without
putting a database on the internet. This is what exists, what it would take, and
which parts are not mine to do.

**Nothing here has been provisioned, enabled or started.**

## What was inspected

All read-only, and most of it already on record from 8 November in
[web-build-and-deploy.md](./web-build-and-deploy.md) and
[preview-environment-safety.md](./preview-environment-safety.md); re-checked
where it matters.

| Thing | State |
| --- | --- |
| Vercel project | `recipebox`, team `benjamin-aird-s-projects`, production `https://recipebox-kappa.vercel.app` |
| Production source | Git integration on `main`. **Every push to any branch creates a Preview deployment** |
| Preview isolation | **None.** Previews receive a `DATABASE_URL`, and Neon has exactly one branch, marked by the Vercel integration as the production branch. A preview's database is almost certainly production's |
| Deployment protection | Vercel SSO on everything except custom domains |
| Neon | Project `recipebox-db` (`polished-bonus-69833220`), one branch (`main`), no preview branches |
| Local database | PostgreSQL 16 in a throwaway Docker container on `127.0.0.1:55432`, created and destroyed per test run |
| Tailscale | **Installed** (`/usr/local/bin/tailscale`) but **stopped**; no peers visible while stopped |
| Expo | `extra.apiBaseUrl` in `app.json`, currently empty. Read at runtime from `Constants.expoConfig`, but **written into the build** |
| EAS profiles | `device-test` (Release, internal) and `development` (dev client, internal) |

## The three ways to do it, and why one wins

### A. A Vercel preview with its own Neon branch

HTTPS and a valid certificate come free, and it is reachable from anywhere.
Three problems:

1. It needs a Neon branch and a Preview `DATABASE_URL` pointed at it — a change
   to shared infrastructure, and if the branch is a data copy rather than
   schema-only it puts **every real user's recipes** into a test database.
2. Previews are behind **Vercel SSO**. A browser can log in; the app's `fetch`
   cannot. It would need a protection-bypass token, which is another secret and
   another thing to leak.
3. It is the environment that currently shares production's database. Getting
   it wrong writes real data.

### B. A public tunnel (ngrok, cloudflared)

Works, valid certificate, nothing installed today. But it puts an
authenticated API with a real sign-in on the public internet for the duration,
and ngrok needs an account and a token — a new secret. Rejected for the risk,
not the effort.

### C. Tailscale Serve → the local server → the local Docker database  ← recommended

`tailscale serve` publishes a local port as
`https://<machine>.<tailnet>.ts.net` with a **real Let's Encrypt
certificate**, reachable **only from your own devices**. Nothing is exposed to
the internet.

```
iPhone  ──WireGuard──▶  Mac  ──▶  node server.js :3100  ──▶  Docker Postgres :55432
         (tailnet only)                                       (bound to 127.0.0.1)
```

Against the requirements:

| Requirement | How C meets it |
| --- | --- |
| Reachable from the physical iPhone | Yes, over the tailnet |
| HTTPS, valid certificate | Yes — `*.ts.net`, issued by Let's Encrypt |
| Isolated accounts and data | A throwaway Docker database, seeded per run |
| No destructive tests on production Neon | Production is never configured |
| Don't expose the local database to the internet | Nothing is public at all; only port 3100 is served, and Postgres stays on `127.0.0.1` |
| Credentials out of the bundle and the repo | The only build-time value is a URL. Keys stay in the shell that starts the server |
| Production cookies, accounts and API untouched | A separate process, a separate database, a separate hostname |

The cost is that the phone must be on the tailnet and the Mac must be awake.
For device testing that is the normal case.

## What I need you to approve or do

These are yours because they need your accounts, and none of them is something
I should do unasked.

1. **Start Tailscale on the Mac** and sign in — `tailscale up`. It is installed
   and currently stopped. I have not started it: it changes the machine's
   network state and needs your login.
2. **Install Tailscale on the iPhone** and sign into the same tailnet.
3. **Enable HTTPS certificates for the tailnet** — Tailscale admin → DNS →
   *Enable HTTPS*. One toggle, free, and required before `tailscale serve` can
   issue a certificate.
4. Confirm you are happy for me to run `tailscale serve --bg --https=443
   http://127.0.0.1:3100` while testing, and to turn it off afterwards
   (`tailscale serve reset`).

**No paid infrastructure, no new secrets, and no production change is required
for option C.** If you would rather have option A, that needs the Neon branch
and the Vercel environment-variable changes in
[preview-environment-safety.md](./preview-environment-safety.md), plus a
decision about SSO bypass — all of which are production-adjacent and need more
than a yes.

## Environment-specific API configuration

`apps/mobile/src/auth/config.ts` reads `extra.apiBaseUrl` from
`Constants.expoConfig`. Three facts follow:

- **It is baked into the build.** A dev build reads it from the Metro manifest,
  so changing `app.json` and reloading is enough. An **EAS build bakes it**, and
  cannot be repointed afterwards.
- **It ships empty.** With no URL the app says it has no sign-in server and the
  Sign in button is disabled, which is why a release build cannot accidentally
  post a password at production.
- **An empty value is not a failure mode to be clever about.** The screens
  already explain it.

### The prerequisite for the next device build

`app.json` is static JSON, so a `device-test` build would bake whatever is in
it at that moment — today, nothing. Before an EAS build is worth making, the
base URL has to come from the build profile rather than from a file somebody
remembers to edit. The small change: convert `app.json` to `app.config.ts` and
read `process.env.RECIPEBOX_API_BASE_URL`, then set that per profile in
`eas.json`. Then one build pipeline can produce a device build pointed at the
tailnet host and, later, a release build pointed at production, without editing
tracked files between builds.

**This is not done.** It changes how the app is configured at build time, and
it is only worth doing at the moment a device build is actually wanted.

## What the local server needs, and what it does without

```sh
# The database: throwaway, local-only, destroyed afterwards.
docker run -d --rm --name rb-staging -e POSTGRES_PASSWORD=pw \
  -e POSTGRES_DB=rb_staging -p 55432:5432 postgres:16-alpine

# The server. RESEND_API_KEY is deliberately absent: without it the app says
# "this server cannot send email yet" instead of pretending a link was sent.
DATABASE_URL=postgres://postgres:pw@localhost:55432/rb_staging PORT=3100 node server.js
```

- **Email.** Verification and password-reset need `RESEND_API_KEY`. Using the
  production key from a test server would send real mail from the real sender,
  so it is left unset. Accounts are verified directly in the test database
  instead, which is what the test suites already do. If you want to exercise
  real delivery, that needs a **separate Resend key with its own sender** —
  a new secret, and therefore your call.
- **AI.** `ANTHROPIC_API_KEY` is unset, so AI import is inert. That is correct
  for this phase: nothing in the native journey needs it.
- **Scraping fallback.** `SCRAPER_API_KEY` unset, so a blocked site stays
  blocked rather than retrying through the proxy. Worth knowing when a real URL
  import is refused in testing: on production it might have succeeded.
