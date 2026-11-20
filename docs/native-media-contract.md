# What the server has to provide for recipe photographs

ADR 0008 has two halves. The device half is built: originals kept whole,
display derivatives beside them, references rather than bytes on the recipe,
and nothing that deletes the only copy. The other half — private object
storage — needs endpoints that do not exist yet. This is what they have to
be, written now so that adding them is a new column and a transport, not a
redesign.

Nothing here is implemented. No storage service has been provisioned, no
bucket exists, and no paid infrastructure has been activated.

## What the device holds today

A photograph taken or chosen on the phone lives at

    <documents>/media/<mediaId>/original     the bytes as they arrived
    <documents>/media/<mediaId>/display.jpg  longest edge 1600, quality 0.82
    <documents>/media/<mediaId>/thumb.jpg    longest edge 320

and the recipe's `heroImage` holds `recipebox://media/<mediaId>`. The path is
never stored: iOS rewrites the container path on reinstall, so it is computed
from the id each time. See `apps/mobile/src/media/`.

A photograph that came from a website is an `https:` URL instead, and is the
publisher's: we do not hold those bytes and must not assume they persist.

## What is needed

### 1. Ask for somewhere to put it

    POST /api/v1/media
    { "recipeId": "...", "mediaId": "...", "contentType": "image/jpeg",
      "bytes": 2413201, "role": "original" | "display" | "thumb" }

    → 200 { "uploadUrl": "...", "objectKey": "...", "expiresAt": "..." }
      413 the file is larger than this account may store
      409 that mediaId already exists for this account, with its objectKey

A pre-signed URL, so the bytes go straight to storage and never through the
API. `mediaId` is the device's, which makes the call idempotent: a retry
after a timeout gets the same key rather than a second object.

### 2. Say it arrived

    POST /api/v1/media/<mediaId>/complete
    { "checksum": "sha256:...", "width": 4032, "height": 3024 }

    → 200 { "url": "...", "expiresAt": "..." }

The server verifies the object exists and the checksum matches before
recording it. ADR 0008's migration safeguards apply in miniature: nothing is
considered stored until it has been confirmed retrievable.

### 3. Read it back

    GET /api/v1/media/<mediaId>?role=display

    → 302 to a short-lived signed URL
      403 not this account's, and not shared with this account

Scoped exactly as recipes are. A household member may read the media of a
recipe shared with them, and not otherwise; the check belongs in the query,
the way `readVisibleRecipesPage` does it, rather than in a separate rule that
can drift.

### 4. Let it go

    DELETE /api/v1/media/<mediaId>

Only the owner. The server is also the only thing that may delete the last
copy, because it is the only thing that knows there is another.

## Rules the device already keeps, which the server must not break

**A failed upload never deletes a local original.** `mayForget` in
`media/store.ts` refuses to discard a photograph that has not been confirmed
stored. The server must therefore never report success it cannot stand behind:
a 200 from `/complete` is the device's cue that a second copy exists.

**Derivatives are regenerable; originals are not.** If storage must shed
something, it sheds display copies. The original is the artifact — a
handwritten card photographed by a grandchild — and ADR 0008 is explicit that
the detail the old web import discarded can never be recovered.

**Stripped metadata travels; the original's does not.** The display and thumb
copies are re-encoded, which drops EXIF — including the GPS coordinates of
somebody's kitchen. Those are the copies that get shared with a household. The
original keeps what it arrived with and stays on the owner's devices and in
their own storage.

## What happens until then

Photographs taken on the phone stay on the phone. They are not uploaded, so
they do not appear on a second device, and a household member sees the
recipe without its picture. The reference is stored on the recipe and
synchronises normally, so the moment the endpoints exist the bytes can follow
without touching a single recipe.

That is a real limitation and the app should not imply otherwise.
