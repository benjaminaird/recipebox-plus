# Consolidating the Mac-only documentation commits

The accepted ADRs **0008–0017**, `docs/product-requirements.md`,
`docs/recipe-model-investigation.md` and the November edits to `CLAUDE.md` and
`GLOSSARY.md` exist only as local commits on the Mac, on
`feature/recipebox-2.0` ending at `6de2255`. GitHub's `feature/recipebox-2.0`
stops at `f5042d8`. This cloud branch (`claude/sweet-wozniak-ye7v06`) was built
without recreating or touching any of them.

## Step 1: on the Mac (the only step that needs you)

```sh
cd ~/Projects/recipebox-plus
git status                                   # uncommitted work? commit it on feature/recipebox-2.0 first
git switch feature/recipebox-2.0
git fetch origin
git log --oneline origin/feature/recipebox-2.0..HEAD      # expect the ADR 0008–0017 work, ending at 6de2255
git diff --stat origin/feature/recipebox-2.0..HEAD         # expect CLAUDE.md, GLOSSARY.md, docs/ only
git diff origin/feature/recipebox-2.0..HEAD | grep -inE "api[_-]?key|secret|password|token=|DATABASE_URL|sk-ant"   # expect nothing
git push origin feature/recipebox-2.0       # a normal push; never --force
```

## Step 2: the merge (a cloud session can do this once step 1 is pushed)

Merge `claude/sweet-wozniak-ye7v06` into `feature/recipebox-2.0` with a merge
commit. No rebase and no history rewriting.

**No conflicts expected.** This branch adds new files and changes only these
existing files:

| File | Change on this branch | Touched on the Mac branch? |
| --- | --- | --- |
| `.gitignore` | ignores `tests/recipe-model/private/*` | no |
| `scripts/nutrition-test.js` | server assertions moved to `nutrition-billing-test.js` | no |

`CLAUDE.md`, `GLOSSARY.md`, ADRs 0001–0007 and every Mac-only file are
untouched here.

Then, in the same change:

1. Fold `docs/product-requirements-addendum-2026-11-08.md` into
   `docs/product-requirements.md` (sections: Visual identity, Appearance,
   Source attribution, Accessibility testing on real devices). Remove "Visual
   direction" from **Unresolved**, then delete the addendum.
2. In `CLAUDE.md` → *Decisions already made*, add 0018, 0019 and 0020. In the
   *Rules* list, add `recipe-library-test` and `nutrition-billing-test` beside
   the domain regression scripts, and note the CI workflow.
3. In `GLOSSARY.md`, extend **Source** and add **Adapted** and **Appearance**,
   as written in the addendum's merge steps.
4. Add one-line cross-references to ADR 0020 in ADRs 0012 and 0009.
5. Run every check: CI must be green, `node scripts/design-tokens-check.js` and
   `node scripts/recipe-model/eval.js` must pass, and `ls docs/adr` must show
   0001–0020.

## What is blocked until then

- Final requirements and glossary agreement (the addendum stays separate).
- Reconciling M1 work with the exact wording of ADR 0012's open questions and
  the investigation plan. The corpus and scorer were built from a recovered
  copy and don't contradict it, but they haven't been checked against the
  committed version.
- Starting the M3 restructure (`packages/recipe-core`). Its preconditions are
  now met on this branch, but the restructure should start from the
  consolidated history.
