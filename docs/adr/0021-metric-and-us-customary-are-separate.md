---
status: accepted
date: 2026-11-11
---

# Metric and US customary are separate measurement systems, and a shopping list never mixes them

`packages/recipe-core/src/shopping-list.js` aggregates a shopping list by
grouping on an ingredient's normalised name plus its **unit class**. Until now
there were two classes: volume, totalled in teaspoons, and weight, totalled in
ounces. There are now four.

| class | totalled in | units |
|---|---|---|
| `volume` | teaspoons | tsp, tbsp, cup, pint, quart, gallon |
| `weight` | ounces | oz, lb |
| `volume-metric` | millilitres | ml, L |
| `weight-metric` | grams | mg, g, kg |

## What was wrong

Grams and kilograms sat in the ounce table, so `500 g` + `250 g` of sugar came
out as **`26.46 oz`**, and `3.6 kg` of chicken as **`3 5/8 kg`** — eighths of a
kilo, from the fraction table that belongs to measuring cups.

Millilitres and litres sat in no table at all, which was worse than a bad
conversion. An unrecognised unit is folded into the ingredient's *name*, so
`500 ml stock` became an item called **`Ml Stock`** and could never combine with
`1 L stock`. A metric cook's list was wrong in the aisle and wrong on the page.

## The decision

**The four classes never combine with each other.** Volume and weight cannot,
in either system: that needs a density per ingredient, which this module does
not have and will not guess.

Metric and US customary *could* — a cup is exactly 236.588 ml — and deliberately
do not. A cook who wrote `1 cup` in one recipe and `250 ml` in another gets two
lines rather than `2.06 cups`. Combining them would print a quantity in a system
one of those recipes never used, at a precision the conversion does not deserve,
and it would change US customary output in any library that contains one metric
recipe. Two honest lines cost a cook a moment's addition; one invented number
costs them the dish.

This is reversible in one function if the trade later looks wrong.

## How a metric quantity is written

A decimal, in the unit a cook would say it in — millilitres below a litre, grams
below a kilo, milligrams below a gram — rounded to a step the kitchen can act
on: 5 g above 50 g, 1 g above 10 g, half a gram below that, and 0.05 for kilos
and litres. Rounding to the equipment rather than to the arithmetic is also what
keeps binary floating point off the screen: `1.8 kg` + `1.2 kg` is
3000.0000000000005 g, and that over 1000 is not 3.

No vulgar fractions. They are an imperial idiom inherited from measuring by cup
and spoon; a system built on tens has no use for them. Cups and spoons keep
theirs, unchanged — `1/4 tsp salt` is still `1/4 tsp salt`.

## Consequences

- **This changes what the live web app shows** for any recipe written in metric.
  It is a correction, approved deliberately, not a silent change. US customary
  output is unchanged, which the regression suites assert rather than assume.
- **The native app lost its own measurement logic.** It had carried two
  workarounds for the defects above — holding metric volumes out of the shared
  module and totalling them itself, and re-rendering metric weight lines. Both
  are deleted. `apps/mobile/src/domain/shoppingList.ts` now contains no
  measurement arithmetic at all, which is the point of ADR 0003: one answer to
  "how much of this do I buy".
- **`apps/mobile/src/domain/units.ts` stays**, for what the shared module
  deliberately does not do: parse ranges, and convert *between* the systems so a
  recipe can be read in the cook's own units. Its parity test holds the two
  together.
- **Original quantities are untouched.** This is display and aggregation only.
  `raw_text`, `quantity` and `unit` survive on every part, the recipe card still
  shows `500 g` as `500 g`, and the stored recipe is not rewritten.
- **A release must bump `VERSION` in `public/sw.js`.** The service worker
  precaches `/shopping-list.js` by cache name, so a returning web user keeps the
  old module until that string changes.
