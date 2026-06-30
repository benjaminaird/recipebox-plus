# Nightmare Recipe Import Report

- Generated: 2026-06-30T12:20:12.663Z
- Manifest: `tests/fixtures/imports/nightmare-recipes/manifest.json`
- Total manifest count: 100
- Recipes tested: 100
- Attempted imports: 89
- Skipped: 11
- Pass / partial / fail / skipped: 88 / 1 / 0 / 11
- Pass rate among attempted imports: 98.9%
- Deterministic pass rate: 100%
- Source-faithful pass rate: 98.9%
- True fail rate among attempted imports: 0%
- Total manifest coverage: 89%
- AI fallback pass rate: 95.5%
- AI fallback requested: yes
- AI fallback implemented in harness: yes
- Estimated AI fallback candidates: 3
- Estimated AI credits if fallback run: 3
- AI usage/spend: $1.198695 of $5 budget; 27 calls
- Average confidence: 87
- Average attempted confidence: 98
- Average audit score: 100
- AI fallback: enabled

## Skip Classification
- blocked_or_inaccessible: 8
- video_transcript_needed: 3

## Coverage By Source Type
| source type | count | attempted | skipped | avg confidence |
| --- | ---: | ---: | ---: | ---: |
| schema_org_web_page | 26 | 23 | 3 | 87 |
| food_blog_page | 59 | 57 | 2 | 94 |
| article_recipe_page | 6 | 3 | 3 | 48 |
| youtube_video | 8 | 5 | 3 | 61 |
| recipe_page_check_access_first | 1 | 1 | 0 | 100 |

## Top Failure Categories
1. accessibility/source coverage: 8
2. video transcript/AI fallback not run: 3
3. quantity grounding: 1
4. unit grounding: 1

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
| nr-046 | pass | 95 | US and metric quantities without duplicate display. |
| nr-049 | pass | 100 | Primary recipe versus variations. |
| nr-055 | pass | 100 | Special-diet substitutions as source-grounded notes. |
| nr-061 | pass | 100 | Marinade/sauce sections and Chinese pantry names. |
| nr-067 | pass | 100 | Japanese pantry terms and egg/dashi quantities. |
| nr-073 | pass | 100 | Ramen components and linked sub-recipe notes. |
| nr-094 | pass | 100 | Large-batch dough, filling, icing, and yield. |

## Top 10 Nightmare Status
| id | status | confidence | must preserve |
| --- | --- | ---: | --- |
| nr-014 | pass | 100 | Keep tangzhong separate from dough and preserve gram alternates. |
| nr-015 | pass | 90 | Direction quantities must bind to the correct cake or frosting section. |
| nr-022 | pass | 95 | Section repeated butter/sugar correctly and preserve rise/chill options. |
| nr-028 | skipped | 0 | Keep fermentation window and oil quantities exactly. |
| nr-075 | pass | 90 | Preserve grams, rest/dry time, and filling quantities. |
| nr-037 | pass | 100 | Keep gram weights and chocolate type/percentage exact. |
| nr-040 | pass | 100 | Keep marinade and sauce stages separated when source supports it. |
| nr-061 | pass | 100 | Keep marinade/sauce components separate and preserve Chinese ingredient names. |
| nr-073 | pass | 100 | Keep component links as notes and avoid flattening all ramen variants into one ingredient list. |
| nr-094 | pass | 100 | Preserve yield and separate dough, filling, and icing. |

## Skipped But Acceptable
- nr-028: blocked_or_inaccessible (article_recipe_page)
- nr-003: blocked_or_inaccessible (schema_org_web_page)
- nr-001: blocked_or_inaccessible (schema_org_web_page)
- nr-026: blocked_or_inaccessible (article_recipe_page)
- nr-095: blocked_or_inaccessible (food_blog_page)
- nr-004: blocked_or_inaccessible (schema_org_web_page)
- nr-027: blocked_or_inaccessible (article_recipe_page)
- nr-096: blocked_or_inaccessible (food_blog_page)

## Skipped And Needs Product Work
- nr-078: video_transcript_needed (youtube_video)
- nr-084: video_transcript_needed (youtube_video)
- nr-083: video_transcript_needed (youtube_video)

## True Failures
None.

## Partial / Review-Needed Cases
- nr-081: confidence 88, audit 82, clusters quantity grounding, unit grounding

## Fixes Applied This Run
- Add source-to-final-output audit fields and source-faithful pass rate.
- Wire --with-ai-fallback to an explicit hard budget, key check, candidate cap, and per-entry usage/cost reporting.
- Preserve deterministic baseline behavior when AI fallback is not explicitly enabled.

## Results
| id | status | skip class | confidence | audit | review | method | source/parsed ingredients | fix category | notes |
| --- | --- | --- | ---: | ---: | --- | --- | ---: | --- | --- |
| nr-014 | pass |  | 100 | 100 | no | schema.org JSON-LD | 11/11 | none |  |
| nr-015 | pass |  | 90 | 100 | no | schema.org JSON-LD | 16/16 | none | Possible duplicate ingredient: King Arthur Pure Vanilla Extract.; duplicate ingredient lines |
| nr-022 | pass |  | 95 | 100 | no | schema.org JSON-LD | 14/14 | none | source mixed °F/°C |
| nr-028 | skipped | blocked_or_inaccessible | 0 | 0 | yes | fallback | /0 | accessibility/source coverage | RecipeBox could not read this recipe page. The site may be blocking automated access. Try Paste Text or screenshots instead. |
| nr-075 | pass |  | 90 | 100 | no | schema.org JSON-LD | 13/13 | none | Possible duplicate ingredient: granulated sugar, vanilla extract.; duplicate ingredient lines |
| nr-037 | pass |  | 100 | 100 | no | schema.org JSON-LD | 8/8 | none |  |
| nr-040 | pass |  | 100 | 100 | no | schema.org JSON-LD | 12/12 | none |  |
| nr-061 | pass |  | 100 | 100 | no | schema.org JSON-LD | 18/18 | none |  |
| nr-073 | pass |  | 100 | 100 | no | schema.org JSON-LD | 17/17 | none |  |
| nr-094 | pass |  | 100 | 100 | no | schema.org JSON-LD | 18/18 | none |  |
| nr-003 | skipped | blocked_or_inaccessible | 0 | 0 | yes | fallback | /0 | accessibility/source coverage | RecipeBox could not read this recipe page. The site may be blocking automated access. Try Paste Text or screenshots instead. |
| nr-002 | pass |  | 95 | 100 | no | schema.org JSON-LD | 11/11 | none | source mixed °F/°C |
| nr-009 | pass |  | 100 | 100 | no | schema.org JSON-LD | 15/15 | none |  |
| nr-010 | pass |  | 100 | 100 | no | schema.org JSON-LD | 10/10 | none |  |
| nr-013 | pass |  | 100 | 100 | no | schema.org JSON-LD | 4/4 | none |  |
| nr-019 | pass |  | 95 | 100 | no | schema.org JSON-LD | 10/10 | none | source mixed °F/°C |
| nr-020 | pass |  | 95 | 100 | no | schema.org JSON-LD | 20/20 | none | source mixed °F/°C |
| nr-024 | pass |  | 95 | 100 | no | schema.org JSON-LD | 11/11 | none | source mixed °F/°C |
| nr-034 | pass |  | 100 | 100 | no | schema.org JSON-LD | 17/17 | none |  |
| nr-032 | pass |  | 100 | 100 | no | schema.org JSON-LD | 17/17 | none |  |
| nr-036 | pass |  | 100 | 100 | no | schema.org JSON-LD | 11/11 | none |  |
| nr-042 | pass |  | 92 | 100 | no | schema.org JSON-LD | 18/18 | none | source mixed US/metric units |
| nr-046 | pass |  | 95 | 100 | no | AI fallback page text | /11 | none | source mixed °F/°C |
| nr-049 | pass |  | 100 | 100 | no | AI fallback page text | /21 | none |  |
| nr-055 | pass |  | 100 | 100 | no | schema.org JSON-LD | 13/13 | none |  |
| nr-067 | pass |  | 100 | 100 | no | schema.org JSON-LD | 12/12 | none |  |
| nr-001 | skipped | blocked_or_inaccessible | 0 | 0 | yes | fallback | /0 | accessibility/source coverage | RecipeBox could not read this recipe page. The site may be blocking automated access. Try Paste Text or screenshots instead. |
| nr-016 | pass |  | 100 | 100 | no | schema.org JSON-LD | 10/10 | none |  |
| nr-021 | pass |  | 95 | 100 | no | schema.org JSON-LD | 19/19 | none | source mixed °F/°C |
| nr-025 | pass |  | 95 | 100 | no | schema.org JSON-LD | 17/17 | none | source mixed °F/°C |
| nr-026 | skipped | blocked_or_inaccessible | 0 | 0 | yes | fallback | /0 | accessibility/source coverage | RecipeBox could not read this recipe page. The site may be blocking automated access. Try Paste Text or screenshots instead. |
| nr-029 | pass |  | 100 | 100 | no | AI fallback page text | /9 | none |  |
| nr-031 | pass |  | 95 | 100 | no | schema.org JSON-LD | 11/11 | none | source mixed °F/°C |
| nr-043 | pass |  | 92 | 100 | no | AI fallback page text | /20 | none | source mixed US/metric units |
| nr-044 | pass |  | 92 | 100 | no | AI fallback page text | /17 | none | source mixed US/metric units |
| nr-062 | pass |  | 100 | 100 | no | schema.org JSON-LD | 15/15 | none |  |
| nr-063 | pass |  | 100 | 100 | no | schema.org JSON-LD | 14/14 | none |  |
| nr-071 | pass |  | 100 | 100 | no | schema.org JSON-LD | 16/16 | none |  |
| nr-095 | skipped | blocked_or_inaccessible | 0 | 0 | yes | clean page text + AI fallback requested | /0 | accessibility/source coverage | blocked_by_cloudflare |
| nr-004 | skipped | blocked_or_inaccessible | 0 | 0 | yes | fallback | /0 | accessibility/source coverage | RecipeBox could not read this recipe page. The site may be blocking automated access. Try Paste Text or screenshots instead. |
| nr-005 | pass |  | 95 | 100 | no | schema.org JSON-LD | 8/8 | none | source mixed °F/°C |
| nr-006 | pass |  | 100 | 100 | no | schema.org JSON-LD | 15/15 | none |  |
| nr-007 | pass |  | 95 | 100 | no | schema.org JSON-LD | 5/5 | none | source mixed °F/°C |
| nr-008 | pass |  | 95 | 100 | no | schema.org JSON-LD | 7/7 | none | source mixed °F/°C |
| nr-011 | pass |  | 100 | 100 | no | schema.org JSON-LD | 9/9 | none |  |
| nr-012 | pass |  | 90 | 100 | no | schema.org JSON-LD | 18/18 | none | Possible duplicate ingredient: pure vanilla extract.; duplicate ingredient lines |
| nr-017 | pass |  | 100 | 100 | no | schema.org JSON-LD | 5/5 | none |  |
| nr-018 | pass |  | 100 | 100 | no | schema.org JSON-LD | 9/9 | none |  |
| nr-023 | pass |  | 100 | 100 | no | schema.org JSON-LD | 5/5 | none |  |
| nr-027 | skipped | blocked_or_inaccessible | 0 | 0 | yes | fallback | /0 | accessibility/source coverage | RecipeBox could not read this recipe page. The site may be blocking automated access. Try Paste Text or screenshots instead. |
| nr-030 | pass |  | 95 | 100 | no | schema.org JSON-LD | 2/2 | none | source mixed °F/°C |
| nr-033 | pass |  | 100 | 100 | no | schema.org JSON-LD | 9/9 | none |  |
| nr-035 | pass |  | 100 | 100 | no | schema.org JSON-LD | 15/15 | none |  |
| nr-038 | pass |  | 100 | 100 | no | schema.org JSON-LD | 8/8 | none |  |
| nr-039 | pass |  | 100 | 100 | no | schema.org JSON-LD | 6/6 | none |  |
| nr-041 | pass |  | 100 | 100 | no | schema.org JSON-LD | 4/4 | none |  |
| nr-045 | pass |  | 95 | 100 | no | AI fallback page text | /5 | none | source mixed °F/°C |
| nr-047 | pass |  | 92 | 100 | no | AI fallback page text | /13 | none | source mixed US/metric units |
| nr-048 | pass |  | 100 | 100 | no | AI fallback page text | /8 | none |  |
| nr-050 | pass |  | 100 | 100 | no | AI fallback page text | /10 | none |  |
| nr-051 | pass |  | 100 | 100 | no | AI fallback page text | /12 | none |  |
| nr-052 | pass |  | 100 | 100 | no | AI fallback page text | /14 | none |  |
| nr-053 | pass |  | 100 | 100 | no | AI fallback page text | /18 | none |  |
| nr-054 | pass |  | 100 | 100 | no | AI fallback page text | /10 | none |  |
| nr-056 | pass |  | 94 | 100 | no | schema.org JSON-LD | 12/12 | none | Some directions may be missing amounts.; directions missing amounts |
| nr-057 | pass |  | 100 | 100 | no | schema.org JSON-LD | 23/23 | none |  |
| nr-058 | pass |  | 94 | 100 | no | schema.org JSON-LD | 12/12 | none | Some directions may be missing amounts.; directions missing amounts |
| nr-059 | pass |  | 100 | 100 | no | schema.org JSON-LD | 14/14 | none |  |
| nr-060 | pass |  | 100 | 100 | no | schema.org JSON-LD | 11/11 | none |  |
| nr-064 | pass |  | 100 | 100 | no | schema.org JSON-LD | 18/18 | none |  |
| nr-065 | pass |  | 90 | 100 | no | schema.org JSON-LD | 9/9 | none | Possible duplicate ingredient: salt.; duplicate ingredient lines |
| nr-066 | pass |  | 100 | 100 | no | schema.org JSON-LD | 24/24 | none |  |
| nr-068 | pass |  | 95 | 100 | no | schema.org JSON-LD | 14/14 | none | source mixed °F/°C |
| nr-069 | pass |  | 95 | 100 | no | schema.org JSON-LD | 7/7 | none | source mixed °F/°C |
| nr-070 | pass |  | 95 | 100 | no | schema.org JSON-LD | 14/14 | none | source mixed °F/°C |
| nr-072 | pass |  | 100 | 100 | no | AI fallback page text | /19 | none |  |
| nr-074 | pass |  | 90 | 100 | no | schema.org JSON-LD | 19/19 | none | Possible duplicate ingredient: spiced rum.; duplicate ingredient lines |
| nr-076 | pass |  | 94 | 100 | no | schema.org JSON-LD | 16/16 | none | Some directions may be missing amounts.; directions missing amounts |
| nr-077 | pass |  | 100 | 100 | no | schema.org JSON-LD | 12/12 | none |  |
| nr-078 | skipped | video_transcript_needed | 0 | 0 | yes | transcript + AI fallback requested | /0 | video transcript/AI fallback not run | not_enough_recipe_text; transcript unavailable; low confidence extraction |
| nr-079 | pass |  | 100 | 100 | no | AI fallback transcript | /14 | none |  |
| nr-080 | pass |  | 100 | 100 | no | AI fallback transcript | /10 | none |  |
| nr-082 | pass |  | 100 | 100 | no | AI fallback transcript | /18 | none |  |
| nr-084 | skipped | video_transcript_needed | 0 | 0 | yes | transcript + AI fallback requested | /0 | video transcript/AI fallback not run | not_enough_recipe_text; transcript unavailable; low confidence extraction |
| nr-085 | pass |  | 100 | 100 | no | AI fallback transcript | /11 | none |  |
| nr-086 | pass |  | 95 | 100 | no | schema.org JSON-LD | 12/12 | none | source mixed °F/°C |
| nr-087 | pass |  | 100 | 100 | no | schema.org JSON-LD | 13/13 | none |  |
| nr-088 | pass |  | 100 | 100 | no | schema.org JSON-LD | 10/10 | none |  |
| nr-089 | pass |  | 100 | 100 | no | schema.org JSON-LD | 19/19 | none |  |
| nr-091 | pass |  | 100 | 100 | no | AI fallback page text | /11 | none |  |
| nr-092 | pass |  | 100 | 100 | no | AI fallback page text | /7 | none |  |
| nr-093 | pass |  | 100 | 100 | no | AI fallback page text | /14 | none |  |
| nr-096 | skipped | blocked_or_inaccessible | 0 | 0 | yes | clean page text + AI fallback requested | /0 | accessibility/source coverage | source_blocked |
| nr-097 | pass |  | 100 | 100 | no | schema.org JSON-LD | 10/10 | none |  |
| nr-098 | pass |  | 95 | 100 | no | schema.org JSON-LD | 9/9 | none | source mixed °F/°C |
| nr-081 | partial |  | 88 | 82 | yes | AI fallback transcript | /4 | quantity grounding | source mixed US/metric units; quantity: uncertain - "200 g thick spaghetti (pici or tonarelli)"; quantity: uncertain - "100 g pecorino cheese, finely grated"; unit: uncertain - "2 tsp freshly ground black pepper" |
| nr-083 | skipped | video_transcript_needed | 0 | 0 | yes | transcript + AI fallback requested | /0 | video transcript/AI fallback not run | not_enough_recipe_text; transcript unavailable; low confidence extraction |
| nr-090 | pass |  | 100 | 100 | no | schema.org JSON-LD | 4/4 | none |  |
| nr-099 | pass |  | 100 | 100 | no | schema.org JSON-LD | 12/12 | none |  |
| nr-100 | pass |  | 90 | 100 | no | schema.org JSON-LD | 19/19 | none | Possible duplicate ingredient: Italian seasoning ($0.02), garlic powder ($0.02), smoked paprika ($0.02), black pepper (freshly cracked, $0.02).; duplicate ingredient lines |

## Debug Outputs
Per-recipe source summaries, raw structured extraction, and normalized RecipeBox JSON are in `tests/results/imports/nightmare-debug/`.
