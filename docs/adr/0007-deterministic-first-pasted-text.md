---
status: accepted
date: 2026-10-16
---

# Pasted text parses deterministically first, with AI as an optional step

Pasted-text Import currently goes straight to the model
(`src/app.jsx:4365`), even though the text is already on the device. A
deterministic text parser already exists in the codebase (`src/app.jsx:4527`),
used only as a recovery path when a thin video or social Import fails.

That parser becomes the **primary** path for pasted text. AI becomes an optional
fallback for prose the parser cannot structure, or an explicit
"improve this" step the user chooses.

A reader might reasonably assume the model should do this work, so the reasoning
is worth recording: it makes the common "type in a family recipe" case work
**offline, instantly, and without spending an AI Assist**, and it matches the
deterministic-first strategy the web Import path already uses for structured
pages. It also turns pasted text into the second
On-device Import, after manual entry.

## Guardrails

- The user **reviews the parsed Recipe before it is saved**. Deterministic
  parsing is not a licence to skip confirmation.
- Neither the parser nor any AI improvement step may silently alter ingredient
  quantities or direction wording. Changes are the user's to make.
- AI is offered, never automatic. Falling through to the model is a visible
  step, not a hidden one, because it spends an AI Assist.
