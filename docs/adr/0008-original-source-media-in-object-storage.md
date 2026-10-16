---
status: accepted
date: 2026-10-16
---

# Original Source media moves to private object storage

Original Source pages and hero images currently live as base64 inside the
`recipe_json` JSONB column. That is why `/api/recipes` carries a 40 MB request
limit and why originals are already excluded from the browser's local mirror to
avoid storage-quota failures. It does not survive contact with a local-first
phone: eagerly syncing every original of a large library would pull down
gigabytes.

Media moves to **private object storage**, with Recipes holding references
rather than bytes. Clients sync a lightweight **thumbnail** eagerly so the
library is never blank offline, fetch the **full original on demand** when a
user opens it, and may **pin** a Recipe to keep its original available offline.

Going forward, Original Source captures are stored at **full quality**.
Handwritten family recipe cards are sentimental artifacts, not just input to the
extractor, and the storage saving that justified compression no longer applies
once media leaves the database.

## The existing originals are already degraded

This must not be mis-sold as a quality restoration. `compressDataUrlForArchive`
(`src/app.jsx:445`) downscales every captured page to **1280px at JPEG quality
0.7** *at import time*. The detail was discarded before storage, so no
migration can recover it. The migration preserves exactly what is currently
stored.

Where a user still has the source photo on their device, re-importing after this
change is the only route to a full-quality original. The app should not imply
otherwise.

## Migration safeguards

The migration is reversible and verified, in this order:

1. Back up the affected `recipe_json` rows before touching them.
2. Write media to object storage and record the reference alongside the
   still-present embedded copy.
3. Verify every new object by checksum and confirm it is retrievable.
4. Only then remove the embedded base64 — never before confirmation, and never
   in the same step as the write.

A failure at any point leaves the embedded originals intact and the app working.
