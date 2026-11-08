---
status: accepted
date: 2026-11-08
---

# Every recipe keeps its original and a reversible history

A Recipe stores the **version it arrived as** and every subsequent version, and
any change can be reverted. This covers edits the user makes by hand, changes
accepted from the AI Recipe Helper (ADR 0016), resolutions of import
uncertainty, and conflict resolutions from sync (ADR 0006).

The imported original is never overwritten. It is the answer to "what did the
source actually say?", which is the question a cook asks when a recipe stops
working.

## Consequences

- Versions are append-only. An edit writes a new version and leaves earlier ones
  intact; nothing in the app mutates a recipe in place.
- Reverting creates a new version restoring earlier content, rather than
  deleting history. History is therefore never lost by undoing.
- Each version records what caused it — imported, edited by hand, accepted from
  the Helper, resolved from a flag, resolved from a sync conflict — so history
  reads as a story rather than a list of timestamps.
- This composes with the conflict copies in ADR 0006: a superseded version from
  a sync conflict is a version like any other.
- Version storage must not bloat the sync payload. Versions sync lazily; only
  the current version is needed to cook. Media is referenced, never duplicated
  per version (ADR 0008).
- Retention is an open question: unlimited history is simplest and honest, but
  needs a size estimate against a large library before being promised.
