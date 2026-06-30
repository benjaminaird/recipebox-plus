# Nightmare Recipe Import Report

- Generated: 2026-06-30T02:15:30.870Z
- Manifest: `tests/fixtures/imports/nightmare-recipes/manifest.json`
- Recipes tested: 100
- Pass / partial / fail / skipped: 67 / 0 / 0 / 33
- Average confidence: 65
- AI fallback: disabled

## Top Failure Categories
1. AI fallback not run: 27
2. accessibility/source coverage: 6

## Top 25 Must-Pass Status
| id | status | confidence | must preserve |
| --- | --- | ---: | --- |
| nr-003 | skipped | 0 | Long clean schema recipe with sauce, cheese, noodles, assembly, and bake stages. |
| nr-002 | pass | 95 | Baking quantities and temperature from a clean schema page. |
| nr-009 | pass | 100 | Brine versus roasting ingredients and timing. |
| nr-010 | pass | 100 | Recipe card content while ignoring embedded video UI. |
| nr-013 | pass | 100 | Source volume and gram weights for bread ingredients. |
| nr-014 | pass | 100 | Tangzhong section separate from dough. |
| nr-015 | pass | 90 | Repeated cake/frosting ingredients with correct direction refs. |
| nr-019 | pass | 95 | Long-blog import with chill time and metric alternates. |
| nr-020 | pass | 95 | Strawberry reduction, cake, and frosting components. |
| nr-022 | pass | 95 | Dough, filling, and icing sections plus rise times. |
| nr-024 | pass | 95 | Source-grounded banana tips as notes, not hallucinated additions. |
| nr-028 | skipped | 0 | Fermentation and bake ranges without collapsing them. |
| nr-037 | pass | 100 | Metric weights, chocolate type/percentage, and brownie doneness cues. |
| nr-034 | pass | 100 | Keep substitutions and toppings out of the required ingredient list. |
| nr-032 | pass | 100 | Ignore cost metadata; preserve one-pot liquid/pasta ratios. |
| nr-036 | pass | 100 | Metric/gas mark UK cake data. |
| nr-040 | pass | 100 | Marinade/sauce stages and spice quantities. |
| nr-042 | pass | 92 | Marinade ingredients and serving suggestions separated. |
| nr-046 | skipped | 0 | US and metric quantities without duplicate display. |
| nr-049 | skipped | 0 | Primary recipe versus variations. |
| nr-055 | pass | 100 | Special-diet substitutions as source-grounded notes. |
| nr-061 | pass | 100 | Marinade/sauce sections and Chinese pantry names. |
| nr-067 | pass | 100 | Japanese pantry terms and egg/dashi quantities. |
| nr-073 | pass | 100 | Ramen components and linked sub-recipe notes. |
| nr-094 | pass | 100 | Large-batch dough, filling, icing, and yield. |

## Results
| id | status | confidence | method | source/parsed ingredients | fix category | notes |
| --- | --- | ---: | --- | ---: | --- | --- |
| nr-014 | pass | 100 | schema.org JSON-LD | 11/11 | none |  |
| nr-015 | pass | 90 | schema.org JSON-LD | 16/16 | none | Possible duplicate ingredient: King Arthur Pure Vanilla Extract.; duplicate ingredient lines |
| nr-022 | pass | 95 | schema.org JSON-LD | 14/14 | none | source mixed °F/°C |
| nr-028 | skipped | 0 | fallback | /0 | accessibility/source coverage | RecipeBox could not read this recipe page. The site may be blocking automated access. Try Paste Text or screenshots instead. |
| nr-075 | pass | 90 | schema.org JSON-LD | 13/13 | none | Possible duplicate ingredient: granulated sugar, vanilla extract.; duplicate ingredient lines |
| nr-037 | pass | 100 | schema.org JSON-LD | 8/8 | none |  |
| nr-040 | pass | 100 | schema.org JSON-LD | 12/12 | none |  |
| nr-061 | pass | 100 | schema.org JSON-LD | 18/18 | none |  |
| nr-073 | pass | 100 | schema.org JSON-LD | 17/17 | none |  |
| nr-094 | pass | 100 | schema.org JSON-LD | 18/18 | none |  |
| nr-003 | skipped | 0 | fallback | /0 | accessibility/source coverage | RecipeBox could not read this recipe page. The site may be blocking automated access. Try Paste Text or screenshots instead. |
| nr-002 | pass | 95 | schema.org JSON-LD | 11/11 | none | source mixed °F/°C |
| nr-009 | pass | 100 | schema.org JSON-LD | 15/15 | none |  |
| nr-010 | pass | 100 | schema.org JSON-LD | 10/10 | none |  |
| nr-013 | pass | 100 | schema.org JSON-LD | 4/4 | none |  |
| nr-019 | pass | 95 | schema.org JSON-LD | 10/10 | none | source mixed °F/°C |
| nr-020 | pass | 95 | schema.org JSON-LD | 20/20 | none | source mixed °F/°C |
| nr-024 | pass | 95 | schema.org JSON-LD | 11/11 | none | source mixed °F/°C |
| nr-034 | pass | 100 | schema.org JSON-LD | 17/17 | none |  |
| nr-032 | pass | 100 | schema.org JSON-LD | 17/17 | none |  |
| nr-036 | pass | 100 | schema.org JSON-LD | 11/11 | none |  |
| nr-042 | pass | 92 | schema.org JSON-LD | 18/18 | none | source mixed US/metric units |
| nr-046 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-049 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-055 | pass | 100 | schema.org JSON-LD | 13/13 | none |  |
| nr-067 | pass | 100 | schema.org JSON-LD | 12/12 | none |  |
| nr-001 | skipped | 0 | fallback | /0 | accessibility/source coverage | RecipeBox could not read this recipe page. The site may be blocking automated access. Try Paste Text or screenshots instead. |
| nr-016 | pass | 100 | schema.org JSON-LD | 10/10 | none |  |
| nr-021 | pass | 95 | schema.org JSON-LD | 19/19 | none | source mixed °F/°C |
| nr-025 | pass | 95 | schema.org JSON-LD | 17/17 | none | source mixed °F/°C |
| nr-026 | skipped | 0 | fallback | /0 | accessibility/source coverage | RecipeBox could not read this recipe page. The site may be blocking automated access. Try Paste Text or screenshots instead. |
| nr-029 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-031 | pass | 95 | schema.org JSON-LD | 11/11 | none | source mixed °F/°C |
| nr-043 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-044 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-062 | pass | 100 | schema.org JSON-LD | 15/15 | none |  |
| nr-063 | pass | 100 | schema.org JSON-LD | 14/14 | none |  |
| nr-071 | pass | 100 | schema.org JSON-LD | 16/16 | none |  |
| nr-095 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-004 | skipped | 0 | fallback | /0 | accessibility/source coverage | RecipeBox could not read this recipe page. The site may be blocking automated access. Try Paste Text or screenshots instead. |
| nr-005 | pass | 95 | schema.org JSON-LD | 8/8 | none | source mixed °F/°C |
| nr-006 | pass | 100 | schema.org JSON-LD | 15/15 | none |  |
| nr-007 | pass | 95 | schema.org JSON-LD | 5/5 | none | source mixed °F/°C |
| nr-008 | pass | 95 | schema.org JSON-LD | 7/7 | none | source mixed °F/°C |
| nr-011 | pass | 100 | schema.org JSON-LD | 9/9 | none |  |
| nr-012 | pass | 90 | schema.org JSON-LD | 18/18 | none | Possible duplicate ingredient: pure vanilla extract.; duplicate ingredient lines |
| nr-017 | pass | 100 | schema.org JSON-LD | 5/5 | none |  |
| nr-018 | pass | 100 | schema.org JSON-LD | 9/9 | none |  |
| nr-023 | pass | 100 | schema.org JSON-LD | 5/5 | none |  |
| nr-027 | skipped | 0 | fallback | /0 | accessibility/source coverage | RecipeBox could not read this recipe page. The site may be blocking automated access. Try Paste Text or screenshots instead. |
| nr-030 | pass | 95 | schema.org JSON-LD | 2/2 | none | source mixed °F/°C |
| nr-033 | pass | 100 | schema.org JSON-LD | 9/9 | none |  |
| nr-035 | pass | 100 | schema.org JSON-LD | 15/15 | none |  |
| nr-038 | pass | 100 | schema.org JSON-LD | 8/8 | none |  |
| nr-039 | pass | 100 | schema.org JSON-LD | 6/6 | none |  |
| nr-041 | pass | 100 | schema.org JSON-LD | 4/4 | none |  |
| nr-045 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-047 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-048 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-050 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-051 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-052 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-053 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-054 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-056 | pass | 94 | schema.org JSON-LD | 12/12 | none | Some directions may be missing amounts.; directions missing amounts |
| nr-057 | pass | 100 | schema.org JSON-LD | 23/23 | none |  |
| nr-058 | pass | 94 | schema.org JSON-LD | 12/12 | none | Some directions may be missing amounts.; directions missing amounts |
| nr-059 | pass | 100 | schema.org JSON-LD | 14/14 | none |  |
| nr-060 | pass | 100 | schema.org JSON-LD | 11/11 | none |  |
| nr-064 | pass | 100 | schema.org JSON-LD | 18/18 | none |  |
| nr-065 | pass | 90 | schema.org JSON-LD | 9/9 | none | Possible duplicate ingredient: salt.; duplicate ingredient lines |
| nr-066 | pass | 100 | schema.org JSON-LD | 24/24 | none |  |
| nr-068 | pass | 95 | schema.org JSON-LD | 14/14 | none | source mixed °F/°C |
| nr-069 | pass | 95 | schema.org JSON-LD | 7/7 | none | source mixed °F/°C |
| nr-070 | pass | 95 | schema.org JSON-LD | 14/14 | none | source mixed °F/°C |
| nr-072 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-074 | pass | 90 | schema.org JSON-LD | 19/19 | none | Possible duplicate ingredient: spiced rum.; duplicate ingredient lines |
| nr-076 | pass | 94 | schema.org JSON-LD | 16/16 | none | Some directions may be missing amounts.; directions missing amounts |
| nr-077 | pass | 100 | schema.org JSON-LD | 12/12 | none |  |
| nr-078 | skipped | 0 | transcript | /0 | AI fallback not run | Transcript/description fetched, but AI extraction is disabled for this run.; transcript unavailable; low confidence extraction |
| nr-079 | skipped | 0 | transcript | /0 | AI fallback not run | Transcript/description fetched, but AI extraction is disabled for this run. |
| nr-080 | skipped | 0 | transcript | /0 | AI fallback not run | Transcript/description fetched, but AI extraction is disabled for this run. |
| nr-082 | skipped | 0 | transcript | /0 | AI fallback not run | Transcript/description fetched, but AI extraction is disabled for this run. |
| nr-084 | skipped | 0 | transcript | /0 | AI fallback not run | Transcript/description fetched, but AI extraction is disabled for this run.; transcript unavailable; low confidence extraction |
| nr-085 | skipped | 0 | transcript | /0 | AI fallback not run | Transcript/description fetched, but AI extraction is disabled for this run. |
| nr-086 | pass | 95 | schema.org JSON-LD | 12/12 | none | source mixed °F/°C |
| nr-087 | pass | 100 | schema.org JSON-LD | 13/13 | none |  |
| nr-088 | pass | 100 | schema.org JSON-LD | 10/10 | none |  |
| nr-089 | pass | 100 | schema.org JSON-LD | 19/19 | none |  |
| nr-091 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-092 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-093 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-096 | skipped | 0 | clean page text | /0 | AI fallback not run | No complete structured recipe found; AI fallback disabled for this run. |
| nr-097 | pass | 100 | schema.org JSON-LD | 10/10 | none |  |
| nr-098 | pass | 95 | schema.org JSON-LD | 9/9 | none | source mixed °F/°C |
| nr-081 | skipped | 0 | transcript | /0 | AI fallback not run | Transcript/description fetched, but AI extraction is disabled for this run. |
| nr-083 | skipped | 0 | transcript | /0 | AI fallback not run | Transcript/description fetched, but AI extraction is disabled for this run.; transcript unavailable; low confidence extraction |
| nr-090 | pass | 100 | schema.org JSON-LD | 4/4 | none |  |
| nr-099 | pass | 100 | schema.org JSON-LD | 12/12 | none |  |
| nr-100 | pass | 90 | schema.org JSON-LD | 19/19 | none | Possible duplicate ingredient: Italian seasoning ($0.02), garlic powder ($0.02), smoked paprika ($0.02), black pepper (freshly cracked, $0.02).; duplicate ingredient lines |

## Debug Outputs
Per-recipe source summaries, raw structured extraction, and normalized RecipeBox JSON are in `tests/results/imports/nightmare-debug/`.
