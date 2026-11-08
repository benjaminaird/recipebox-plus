# Public-repository test data: audit and cleanup proposal

Audited 2026-11-08. **Nothing has been deleted, and Git history has not been
rewritten.** This is a proposal for your approval.

## What is in `tests/results/` (tracked, public)

| Path | Files | Contents | Exposure |
| --- | --- | --- | --- |
| `imports/nightmare-debug/nr-*/raw-extraction.json` | 96 | Complete extracted recipes: ingredient lists, **full method text** (about 171,000 characters), **descriptions/headnotes** (about 21,000), **notes** (about 22,000), hero-image URLs, and in 5 files the model's raw response | **High**: verbatim expressive text from 20 publishers (King Arthur, Allrecipes, Sally's Baking Addiction, Love & Lemons, Just One Cookbook, BBC Good Food, RecipeTin Eats, Minimalist Baker, The Woks of Life, Budget Bytes, Food Network, YouTube descriptions and others), republished in a public repo |
| `imports/nightmare-debug/nr-*/normalized.json` | 91 | The same recipes after RecipeBox normalisation | **High**: same text |
| `imports/nightmare-debug/nr-*/source-summary.json` | 100 | URL, fetch status, page title, counts, warnings | Low: metadata |
| `imports/nightmare-report.json` / `.md` | 2 | Per-case scores, statuses, titles, URLs, short audit notes in our own words | Low: metadata; the longest string is a URL |

Total: about 2.4 MB, added on 29–30 June 2026 (`b3e88ad` … `9c60679`).

**Not found:**

- email addresses or personal data;
- private family recipes;
- photos.

Real cards and photos stay in the gitignored `scripts/import-test/sources/` and
`tests/recipe-model/private/`. The nightmare manifest itself is fine: it holds
URLs plus preservation notes in our own words, and its own rule is "URLs only;
do not scrape or store recipe content in this fixture".

**Why it matters:**

- Ingredient lists are largely factual, but method text, headnotes and notes are
  the publishers' expressive writing.
- The repository is public, so this republishes about 90 recipes in full.
- It also contradicts the manifest's own rule.

## What depends on it

| Consumer | Needs the raw text? |
| --- | --- |
| `scripts/nightmare-report-test.js` | No. Reads only `nightmare-report.json` (metadata). |
| `scripts/nightmare-import-test.js` | **Writes** these files on every run (a network and AI harness, never run in CI). |
| `scripts/recipe-model/eval.js` (M1 baseline) | **No longer.** As of `212c5bd` it reads `tests/recipe-model/recorded-structure.json`, counts only. Verified to match the baseline with `nightmare-debug/` moved away. |
| CI | No job reads `nightmare-debug/`. |
| Docs | `docs/recipe-model-baseline.md` cites aggregate counts and case ids only. |

**So removing the raw files from the tip breaks no test and loses no baseline
number.**

## Options

### A. Stop tracking from now on (recommended)

1. `git rm -r --cached tests/results/imports/nightmare-debug`. The files leave
   the current tree but stay on any machine that already has them.
2. Add `tests/results/imports/nightmare-debug/` to `.gitignore`.
3. No code change is needed. `nightmare-import-test.js` already writes to that
   folder, which is now ignored.
4. Keep `nightmare-report.json`, `nightmare-report.md` and the
   `source-summary.json` files (metadata). Optionally move the summaries next to
   the report.

**Impact:**

- `nightmare-report-test`, CI and the M1 baseline are unaffected (verified).
- After this, you need a local nightmare run to inspect a raw extraction. That
  is the intended workflow anyway.
- **The text stays in Git history** (commits `b3e88ad`–`9c60679`) and in any
  clone or fork. Option A stops ongoing republication in the browsable tree and
  prevents new additions. It doesn't erase the past.

### B. Option A, plus a history purge

1. Rewrite history with `git filter-repo --path tests/results/imports/nightmare-debug --invert-paths`.
2. Force-push every branch that contains those commits: `main`,
   `feature/recipebox-2.0`, `codex/category-movement-ui`,
   `codex/recipe-persistence-repair` and this branch.
3. Ask GitHub Support to purge cached views.

**Impact:**

- All commit hashes from June 29 onwards change.
- **Vercel's production deployment references `main` at `7d70c20`, which would
  no longer exist under that hash.** Future deploys are fine, but rollbacks to
  older deployments lose their Git link.
- **Your Mac's unpushed `feature/recipebox-2.0` commits would need rebasing** onto
  the rewritten history before they could be pushed.
- Existing clones and forks keep the old objects.

Your instructions forbid rewriting history without approval, and **I recommend
against it** unless a publisher asks for removal. If that happens, do it after
the Mac consolidation, in one coordinated step.

### C. Keep everything

Not recommended. It is the current exposure.

## What would replace the regression value

The raw files are a *snapshot of past outputs*, not truth. Their testing value
is now covered without third-party text:

- **Structural regression:** `tests/recipe-model/recorded-structure.json`. It
  records per-case counts (steps, links, invalid references, divided
  ingredients, float artefacts) and nothing else.
- **Behavioural regression:** the synthetic M1 cases, written for RecipeBox, and
  the existing synthetic import fixtures.
- **Real-world spot checks:**
  - the nightmare manifest (URLs only), re-run locally when needed;
  - outputs written to the ignored folder;
  - any page snapshots kept in a **private** store, verified by hash, as already
    planned in `docs/m1-plan.md`.

## Decision needed

Approve **Option A** and I'll make it as one small commit on this branch:
`git rm --cached` plus the `.gitignore` rule, with no history rewrite. Choose
**B** only if you want the history purged. It should wait until your Mac
commits are pushed and merged.
