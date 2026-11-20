# The Helper's model: what to measure, what it costs, and what it needs

[ADR 0017](adr/0017-model-selection-is-measured.md) says the production model is
chosen by running candidates and comparing accuracy, latency and real cost — and
that the budget is agreed before the bake-off runs. This is that agreement,
written down so the decision is a decision and not an omission.

**Nothing in the repository spends anything.** The harness runs at $0 in CI, and
`scripts/recipe-model/bakeoff.js` with no arguments prints the plan and exits.
Running it for real needs both `ANTHROPIC_API_KEY` and `--spend-approved`, and
stops at `--max-calls` regardless.

## What is ready now

`node scripts/recipe-model/eval.js` scores, with no network and no key:

- the import corpus, as before — 24 cases, unchanged by this milestone;
- the 13 recorded **adjustment candidates**, through the validator that now
  ships in `packages/recipe-core`;
- 16 recorded answers across 4 **adjustment tasks**, which are new.

A task is a recipe, a request in a cook's words, and deterministic assertions
about what any acceptable answer must and must not do. The four:

| Task | Request | What it is for |
|---|---|---|
| `bars-lower-sugar` | "Make these lower in sugar." | the straightforward case, and whether the oven and the tin survive it |
| `bars-gluten-free` | "Make this gluten-free." | an allergen request: the wheat has to go, the oats have to be mentioned, and nothing may be declared safe |
| `bars-divided-butter` | "Use less butter." | a divided ingredient — the total, both step shares and both step wordings have to move together |
| `bars-more-moist` | "Make these more moist." | a request with several reasonable answers, where asking is correct and guessing is not |

Each file carries recorded answers, careful and careless, every one declaring
the findings it should produce. That is what proves the **scorer** — that a
careless answer is caught and a careful one is not — before a model is ever
asked anything. A fixture answer is never evidence about a model.

## What the bake-off would measure

Scored by code, against the applied recipe, not against the model's prose.
"Lower the sugar" is scored by the sugar being lower.

| Metric | How |
|---|---|
| Structured-output validity | did the answer survive `readProposal` and produce a tool call at all |
| Instruction following | did what the cook asked for actually happen (`NOT_REMOVED`, `NOT_REDUCED`, `DID_NOT_ASK`) |
| Ingredient and step consistency | the recipe model's own verdict — portions, references, preparations, attribution |
| Hallucination | ingredients added that nobody asked for (`ADDED_SOMETHING_UNASKED`, `TOO_MANY_ADDITIONS`) |
| Collateral damage | times, temperatures and pan sizes still present (`LOST_AN_INVARIANT`) |
| Required caveats | an allergen or nutrition request carries its uncertainty where the screen shows it as one (`NO_CAVEAT`) |
| Latency | wall clock per call, median and worst, as a cook would feel it |
| Cost | from the token counts the API reports, never list price × an assumption |
| Correction rate | how often the endpoint's one repair round trip was needed, since that is a doubled bill and a doubled wait |

It calls through `lib/ai-helper.js`, so what is measured is the prompt and the
tool schema the server actually sends, including the one correction round trip.
A bake-off against a prompt written for the bake-off measures the bake-off.

**Culinary plausibility is only partly reachable this way, and the harness does
not pretend otherwise.** A task encodes the hard rules a cook would not argue
with. Whether gluten-free crumble bars with that much xanthan gum are *nice*
needs a person to read the answers, and the run writes them all out so somebody
can. That reading is part of the decision, not an optional extra.

## Candidates

The current generation, plus the incumbent as the baseline to beat.

| Model | Input $/Mtok | Output $/Mtok | |
|---|---:|---:|---|
| `claude-haiku-5-5` | 0.10 | 0.50 | |
| `claude-sonnet-5-5` | 2.00 | 10.00 | |
| `claude-opus-5-5` | 4.00 | 20.00 | |
| `claude-sonnet-5` | 2.00 | 10.00 | baseline: what `src/app.jsx` has hardcoded since before there was a corpus |

Prices as of 2026-11-08, from ADR 0017. The report prints that date beside every
cost column, because the tokens are facts from the API and the money is
arithmetic on top of a number a human typed.

## What it costs

4 tasks × 3 repeats × 4 candidates, plus a correction round trip on an assumed
40% of them:

```
claude-haiku-5-5      17 calls   $0.01
claude-sonnet-5-5     17 calls   $0.18
claude-opus-5-5       17 calls   $0.37
claude-sonnet-5       17 calls   $0.18   (baseline to beat)
                      68 calls   $0.75
```

At 5 repeats, about **$1.25**. If the task corpus grows to the dozen it should
have before a model is actually chosen, about **$15**, and I would cap it at
**$25** to cover re-runs after a prompt change.

Repeats matter more than they look: the same request twice does not give the same
answer, and a model that is right two times in three is not the same product as
one that is right every time. Three is the minimum worth reporting; five is
better and still costs less than lunch.

**So the money is not the reason to ask.** It is that these are paid API calls
and the instruction is not to spend without approval. Say the word and it runs.

## What it needs

- `ANTHROPIC_API_KEY` with access to the four models above. A key that already
  exists for the web app's `/api/ai` is the same key; nothing new is required
  unless you would rather the evaluation spend be separable in the billing,
  which is a reasonable thing to want and would mean a second key.
- No database, no deployment, no device. It runs on a laptop.
- No production change. The run writes to
  `tests/recipe-model/private/out/bakeoff.json`, which git ignores because it
  holds model output.

## After it runs

A result is not a deployment. Three things follow, and each is its own decision:

1. **The number goes in the repository.** A later model release is then
   evaluated against a recorded baseline rather than swapped in on faith, which
   is the whole point of ADR 0017.
2. **The server allowlist needs the winner in it.** `ALLOWED_AI_MODELS` in
   `server.js` currently holds `claude-sonnet-5`,
   `claude-sonnet-4-5-20250929` and `claude-haiku-4-5-20251001` — all
   previous-generation ids, and `sanitizeAiBody` silently coerces anything else
   to the default. So a winning model does nothing until that list and
   `DEFAULT_AI_MODEL` change, which is a production configuration change and
   not part of a measurement.
3. **Different paths may want different models.** ADR 0017 says so already. A
   deterministic structured import uses no model at all; an adjustment is a
   narrow, heavily-prompted task on a small document, which is exactly the shape
   where the cheap model often holds. One global default is the starting point,
   not a conclusion.

And one thing that does not follow: **no model is adopted because it is newer or
because it topped a table.** ADR 0017 asks for the cheapest model that holds
accuracy on the corpus, and the corpus is the authority.
