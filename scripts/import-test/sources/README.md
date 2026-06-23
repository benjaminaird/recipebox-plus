# Drop your own real sources here to test them

- Put recipe **photos / screenshots** (jpg, png, heic→convert to jpg first) in `photos/`
- Put recipe **PDFs** in `pdfs/`

Then add an entry to ../manifest.json, e.g.:
  { "category": "photo", "id": "photo-grandma-card", "file": "sources/photos/grandma.jpg", "label": "Grandma's handwritten card" }
  { "category": "pdf",   "id": "pdf-church-cookbook", "file": "sources/pdfs/cookbook.pdf", "label": "Church cookbook page" }

For photos/PDFs you can eyeball accuracy in the report (the source sits next to the import).
If you want an automatic score, add a ground-truth file and reference it with "groundTruthFile".
