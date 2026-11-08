---
status: accepted
date: 2026-11-08
---

# The production model is chosen by measurement, not by reputation

The web app hardcodes one model (`DEFAULT_AI_MODEL = "claude-sonnet-5"`,
`src/app.jsx`). That choice predates the import corpus and was never measured
against alternatives. Before the native client ships, the production model is
selected by **running candidates against the import corpus** and comparing three
things together:

1. **Accuracy** — extraction fidelity and correct step-to-ingredient linking,
   scored on the corpus from the recipe-model investigation.
2. **Latency** — time to a usable recipe, per import path. A photo import that
   takes 40 seconds fails differently from one that takes 8.
3. **Real operating cost** — measured token spend per import on real sources, not
   list price per million tokens. Long video transcripts and multi-page PDFs
   dominate cost and are exactly what list price hides.

No model is adopted because it is newer or more capable in general. Import
extraction is a narrow, heavily-prompted task, and the cheapest model that holds
accuracy on the corpus is the right production default.

## Candidates and list prices

Per million tokens, input / output, as of 2026-11-08:

| Model | Input | Output |
| --- | ---: | ---: |
| `claude-haiku-5-5` | $0.10 | $0.50 |
| `claude-sonnet-5-5` | $2.00 | $10.00 |
| `claude-opus-5-5` | $4.00 | $20.00 |

The 20× input spread between Haiku 5.5 and Sonnet 5.5 is the reason this is
worth measuring rather than assuming. `claude-sonnet-5` (the current hardcoded
model) is a previous-generation ID and is included only as the baseline to beat.

## Consequences

- The corpus is a prerequisite. Without it there is nothing to measure against,
  so this work sits behind the recipe-model investigation.
- Different paths may warrant different models. Deterministic JSON-LD imports use
  no model at all; a clean pasted-text parse may need far less than a
  photographed handwritten card. A single global default is the starting point,
  not a requirement.
- Effort level is part of what gets measured, not a separate decision — the same
  model at a lower effort may beat a larger model at cost and latency with no
  accuracy loss.
- The result is recorded with its numbers, so a later model release is evaluated
  against a baseline rather than swapped in on faith.
- Measurement spends real money. The budget is agreed before the bake-off runs.
