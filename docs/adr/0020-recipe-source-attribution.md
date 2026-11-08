---
status: accepted
date: 2026-11-08
amends: ADR 0004, 0006, 0009, 0012, 0014, 0015, 0016
---

# Recipe Source attribution is structured, durable and always visible

RecipeBox preserves and clearly displays where a Recipe came from. In
`GLOSSARY.md` terms this is the **Source**: the attribution, not the
**Original Source** media covered by ADR 0008. Attribution is part of what a
Recipe *is*. It respects the person who wrote the recipe, lets the cook go back
to the original when something doesn't work, and makes clear when the version
in RecipeBox has been adapted.

## What exists today

The web app stores a single string, `recipe.sourceUrl`, set by link and video
imports (`src/app.jsx`, the URL import path). It records no site name, no
original title, no author or creator and no import method. Recipe Detail never
shows the source. It appears only as an "Imported from …" line in PDF export and
sharing. The server's page fetch already reads `og:title` and the final
redirected URL. The YouTube path already receives the channel name (oEmbed
`author_name`) but uses it only as prompt context. The JSON-LD extractor does
not read `author` or `publisher`.

## The model

A Recipe carries a `source` object alongside its content (extending ADR 0012):

| Field | Meaning |
| --- | --- |
| `kind` | `website`, `video`, `social`, `cookbook`, `magazine`, `family`, `other` or `unknown`. |
| `url` | The page the recipe came from, after redirects, with known tracking parameters (`utm_*`, `fbclid`, `gclid`, `igsh`, `si`) removed. Only `http` and `https` are accepted. |
| `submittedUrl` | What the user pasted, kept only if it differs from `url` (shortened links, share links). |
| `siteName` | The publication or site: `og:site_name`, then JSON-LD `publisher.name`, then null. Display falls back to the host. |
| `domain` | The host of `url`, stored so it shows offline without parsing. |
| `originalTitle` | The title as the source published it. Independent of the Recipe's own title, which the user may rename. |
| `author` | The person credited: JSON-LD `author`, the video channel or the social account name, as published. |
| `platform` | For video and social: `youtube`, `tiktok`, `instagram`, `facebook`, `pinterest` and so on. |
| `reference` | Free text for things without a link, such as "*Salt Fat Acid Heat*, p. 212" or "Grandma Ruth's card". |
| `method` | How it arrived: `link`, `video`, `social`, `photo`, `pdf`, `pasted-text` or `manual`. |
| `capturedAt` | When it was imported or first entered. |
| `fieldOrigin` | Per field, whether it was `extracted` or `user`-entered, so a correction is never mistaken for extracted data and re-import never overwrites what the user typed. |

The model also records **derivation**: `status` is `original` or `adapted`,
plus `basedOnVersion`, a pointer to the imported original version (ADR 0015).
`adapted` means the current content differs from the imported original by hand
edits or accepted Recipe Helper changes. It is recalculated whenever a version is
written, so it cannot drift from the history it summarises.

**Every field is optional.** A missing value is shown as missing, never guessed
(ADR 0014): no inventing an author, no back-filling an original title from the
current title.

## Rules

1. **Import fills what the source states.** Website imports save the cleaned
   URL, site name, original title and author when available. Video and social
   imports save the post or video URL, platform, creator and the post or video
   title. Photo, PDF, pasted-text and manual recipes start with `kind: unknown`
   (or `family` when the user says so) and an empty attribution.
2. **The user can add or correct any field**, for any recipe, in Import Review
   and from Recipe Detail. Adding a source is never required to save.
3. **Adapting never removes attribution.** Hand edits and Recipe Helper changes
   (ADR 0016) carry `source` forward unchanged. The Helper may not edit
   `source` at all. Only an explicit source edit changes it, and that edit is
   its own version (cause: *source edited*), so it can be reverted (ADR 0015).
   The imported original version keeps the attribution as it arrived, forever.
4. **Offline:** source details are stored with the Recipe in the local database
   (ADR 0004) and are always readable. Opening the original page needs a
   connection. Offline, the action stays visible and explains that, rather than
   disappearing or failing silently.
5. **Sync** treats `source` as part of the Recipe record. Conflicts follow
   ADR 0006 (last write wins, loser kept as a recoverable copy). Source fields
   are never merged across conflicting versions.
6. **Household sharing:** a Recipe shown to or copied by another household
   member keeps its `source`. A copy also records who it was saved from, as a
   separate field that never replaces the original attribution.
7. **Portable export** (ADR 0009) includes `source` and `derivation` verbatim.
   Restoring an export preserves them exactly, including `method` and
   `capturedAt`. A restore is not a new import.
8. **Compatibility with the web app (ADR 0005):** native clients keep writing
   the legacy `sourceUrl` string as a mirror of `source.url`. Existing recipes
   with only `sourceUrl` are read as `{ kind: website or video by host, url,
   domain, method: link }`, with every other field left empty. The server
   already stores the recipe JSON with unknown fields intact. Before native
   writes `source`, the web app's edit-and-save path must be proven to round-trip
   it without dropping it (see the M3 readiness notes).
9. **Safety and privacy:** links open in the in-app browser
   (`expo-web-browser`: Safari View Controller or Custom Tabs), never in a
   WebView inside RecipeBox. Only `http` and `https` URLs open. RecipeBox does
   not fetch favicons or remote logos to decorate a source: a monogram tile
   keeps it offline-safe and avoids contacting third parties on every view.

## Presentation

Attribution must be clear without getting in the way of ingredients or Cook
Mode.

- **Byline** under the Recipe Detail title: "From *Northfield Kitchen*" or
  "Adapted from *Northfield Kitchen*". It is tappable and moves to the Source
  section.
- **Source section** at the end of Recipe Detail, after the method and notes.
  It has the same visual weight as a notes card, never a hero-sized card. It
  shows:
  - a monogram tile, the site or reference name, and the domain and author;
  - the original title;
  - how and when the recipe was added;
  - "This version: Same as the original" or "Adapted · *n* changes", with a
    link to the version history;
  - one secondary button, **View Original Recipe**, when there is a URL. Its
    accessibility label names the destination ("opens northfieldkitchen.com in
    your browser").
  - an **Edit** action.
- **Cook Mode does not show the source.** It is not needed at the counter.
- **Import Review** shows what was captured as a compact row, with
  "Add source" or "Edit" beside it. Low-confidence extracted fields are flagged
  in place, like any other uncertainty (ADR 0014).
- **PDF and share** keep an attribution line built from `siteName`, `author` and
  `url`.

## Consequences

- The M1 import corpus gains expected attribution per fixture: cleaned URL,
  site name, original title and author where the page states them. It is
  scored alongside ingredients and steps, so attribution quality is measured,
  not assumed.
- The deterministic extractor needs small additions (JSON-LD
  `author`/`publisher`, `og:site_name`). These belong in `packages/recipe-core`
  after M3, with regression fixtures. The web app's import behaviour does not
  change before then.
- The export format version that first includes `source` documents the legacy
  `sourceUrl` mapping, so older exports still restore.
