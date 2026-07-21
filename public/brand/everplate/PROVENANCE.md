# EverPlate production asset provenance

Created on 2026-07-21 from the user-approved EverPlate brand guide. The guide was used as a visual reference only; no screenshot crop is shipped as production artwork.

## Vector identity

- The circular E monogram was reconstructed as deterministic SVG geometry and a converted Lora glyph path.
- The EverPlate wordmark was shaped with HarfBuzz, converted from the locally installed Lora Regular font to paths with fontTools, and contains no live SVG text.
- All SVG masters carry `asset-status=production` metadata.
- AI-generated lettering and monogram geometry were used only for focused visual comparison and were not retained in production artwork.

Lora is distributed under the SIL Open Font License 1.1. Source Sans 3, used by the product UI, is also distributed under the SIL Open Font License 1.1. License texts are preserved in `fonts/`.

## Generated photographic source

The photographic hero source was generated through the OpenAI Images edit endpoint with model snapshot `gpt-image-2-2026-04-21`, quality `high`, size 1536×1024, and the user-supplied guide as a mood/material reference. It contains no production logo or embedded typography. Candidate 2 was selected for its clean negative space and controlled geometry.

Versioned prompts live in `tools/everplate-assets/prompts/`. The committed candidate archive and selection record live in `tools/everplate-assets/review/`. Authentication headers, credentials, API request identifiers, and private source paths are intentionally excluded.

The production review archive contains 15 high-quality outputs: three monogram, three wordmark, three app-icon, two light-splash, two dark-splash, and two hero candidates. At OpenAI's 2026-07-21 published GPT Image 2 output rates, these sizes represent an estimated $2.751 in image-output charges. Two non-retained low-quality authentication renders add an estimated $0.012. The Images API response did not include a final billed total, so edit-input image and prompt tokens are not guessed here; the API billing dashboard remains authoritative for the exact total.

## Derivation

`tools/everplate-assets/scripts/build_assets.py` deterministically generates raster masters, icons, splash screens, platform catalogs, in-app marks, and store compositions. Store artwork combines the selected photographic source with the path-based EverPlate lockup; it does not preserve AI-generated lettering.

No asset in this library was deployed, uploaded to an app store, or applied to the RecipeBox product identity as part of generation.
