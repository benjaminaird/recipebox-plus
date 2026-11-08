# Private recipe-model cases (not committed)

Everything in this folder except this README is ignored by git. Put real family
recipe cards, photos, screenshots, PDFs and any recipe you don't want published
here. The repository is public.

```
private/
  cases/   <id>.case.json   same format as ../cases (see ../README.md)
  media/   photos, scans, PDFs referenced by those cases
  out/     written by the evaluator; scores for private cases
```

`node scripts/recipe-model/eval.js` scores private cases into `private/out/report.json`.
Their results never enter `baseline.json`.

Before committing anything from this area, run `git status` and check that
nothing under `tests/recipe-model/private/` other than this README is staged.
