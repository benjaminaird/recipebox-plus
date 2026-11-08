# Vercel preview safety

**Status (2026-11-08): previews are NOT shown to be isolated from production.
Preview write-testing is blocked.**

## What was checked (all read-only)

| Check | Result |
| --- | --- |
| `GET /api/health` on this branch's latest preview (`recipebox-ck6hm9ti9-…vercel.app`, commit `94fa384`) | `{"status":"ok","database":true}`, so **Preview deployments have a `DATABASE_URL`**. The route only reports whether the variable is set (`server.js:2284`). It doesn't query the database. |
| Vercel environment variables (names and targets only, no values) | **Not readable.** The Vercel API returned 403 for this connection, both for the project and for a branch filter. |
| Vercel integrations (for example Neon's preview-branching integration) | **Not readable** (403). |
| Neon projects | One RecipeBox database: project `recipebox-db` (`polished-bonus-69833220`). |
| Neon branches of `recipebox-db` | **Exactly one branch, `main`.** Neon marks it as the "vercel production branch", with delete and endpoint moves restricted for that reason. **No preview branches exist**, although this branch alone has produced at least eight preview deployments. |
| Supabase projects | None for RecipeBox (`forgeledger`, `duty-manager`, `whatsnext` only). The old Supabase migration notes are historical. |

## Conclusion

Neon's Vercel integration has marked `main` as the production branch, and no
per-preview branches exist. So the `DATABASE_URL` that previews receive almost
certainly points at **the production database**. The alternative would be a
database outside every Neon and Supabase project visible to this session. That
can't be ruled out, but there's no evidence of one.

The AI, email and other keys can't be inspected. Assume Preview has the same
`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `YOUTUBE_API_KEY`, `SCRAPER_API_KEY`,
`JINA_API_KEY` and `MASTER_ADMIN_*` values as Production until shown otherwise.

**Consequences, today:**

- Signing up, signing in, saving a recipe, or running
  `scripts/preview-save-verification.js` on *any* preview, from any branch,
  reads and writes **real users' data**.
- An AI import on a preview spends production AI budget and counts against
  real users' AI Assists.
- Previews are behind Vercel SSO, so this needs a logged-in team member. It's
  a risk from our own testing, not from the public.

**Disclosure:** reading the protected health endpoint created a temporary Vercel
share link for that one preview deployment. It expires within 23 hours.

## Required configuration changes (owner action, in the Vercel and Neon dashboards)

I haven't made any of these. They change shared infrastructure and need your
approval and access.

**Option A: previews have no database (recommended now; simplest and safest).**

1. Vercel → `recipebox` → Settings → Environment Variables.
2. For `DATABASE_URL`, untick **Preview** (keep Production; keep Development
   only if you use `vercel dev` deliberately).
   - If the variable is managed by the Neon integration, change it in the
     integration's settings instead.
3. Do the same for `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `YOUTUBE_API_KEY`,
   `SCRAPER_API_KEY`, `JINA_API_KEY`, `MASTER_ADMIN_EMAIL`,
   `MASTER_ADMIN_PASSWORD` and `MASTER_ADMIN_PASSWORD_HASH`.
4. Add `AI_IMPORTS_ENABLED=false` and `AI_ADJUST_ENABLED=false` for **Preview
   only**, as a second guard.
5. Redeploy one preview. The new values only apply to new deployments.

Previews then run in the same no-database mode CI already tests. They are
useful for "does it build and render", not for account testing.

**Option B: previews get their own database (later, when account flows need
preview testing).**

1. In Neon, create a branch of `recipebox-db` named `preview`.
   - Prefer **schema-only**: a full branch copies every real user's recipes and
     profile into the preview database.
2. Point Preview's `DATABASE_URL` at that branch's pooled connection string.
3. Or enable the Neon integration's per-preview branching. It creates a branch
   per deployment, but those branches are **data copies** by default.

Option B also needs the key changes in Option A, steps 3 and 4. Use separate,
low-limit keys if previews must exercise AI.

## How to confirm the fix (read-only, I can do this)

After Option A, `GET /api/health` on a fresh preview must return
`"database":false`.

After Option B, `database` stays `true`. Confirm the `preview` branch shows
compute activity in Neon when a preview handles a request, and `main` does not.

**Until one of these is confirmed, `preview-save-verification.js` and any
sign-in or save on a preview stay blocked.** Use
`node scripts/web-preview-check.js` (local, no database, no keys) instead. CI
runs it on every push.
