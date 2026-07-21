# EverPlate asset generation tools

Development-only tooling for the EverPlate production brand library. Nothing in
this directory is included by the RecipeBox or EverPlate runtime bundles.

## Security model

- The API key is read at runtime from the macOS login Keychain service
  `com.openai.recipebox-plus.everplate`.
- `bin/image-gen` never prints the key and does not persist it to disk.
- The key exists only in the child process environment used for the API call.
- `.venv`, `tmp`, `logs`, and `local` are ignored by Git.
- Prompts, selected outputs, and committed provenance contain no authentication
  headers, request IDs, secrets, or private machine paths.

## Setup

```sh
tools/everplate-assets/bin/bootstrap
tools/everplate-assets/bin/image-gen generate --help
```

The wrapper invokes Codex's bundled `image_gen.py`; it does not duplicate the
OpenAI SDK integration. Override its location with `EVERPLATE_IMAGE_GEN_CLI`
only when intentionally testing another copy of the same bundled CLI.

## Generation policy

- Model snapshot: `gpt-image-2-2026-04-21`
- Quality: `high`
- Reference-based concepts use the Image API edits endpoint.
- Generated lettering is never accepted as final. Production monogram and
  wordmark artwork is reconstructed as deterministic vector paths.
- Raw outputs go under ignored `tmp/`. Viable candidates are copied into the
  committed review archive only after visual inspection.

See `prompts/` for versioned production briefs. The approved guide is supplied
at runtime as a local reference and is not copied or cropped into final assets.
