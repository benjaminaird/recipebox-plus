---
status: accepted
date: 2026-11-08
---

# The product is called RecipeBox, with no version or tier in the name

The product's only user-facing name is **RecipeBox**. Two names used earlier in
planning are now obsolete in anything a user sees:

- **"RecipeBox 2.0"** — a planning label for the native rewrite, never a product
  name. The product is RecipeBox; the native app is simply RecipeBox on iOS and
  Android.
- **"RecipeBox Plus"** — previously reserved for a future paid tier. Not used.
  If a paid tier ships, its name is an open question, decided then.

**Technical identifiers deliberately keep their old names.** The repository is
`recipebox-plus` and the development branch is `feature/recipebox-2.0`. Renaming
either would break remotes, the Vercel project link and existing checkouts for
no user-visible gain. A future reader will notice the mismatch; it is intentional.

ADRs 0001–0012 were written while "RecipeBox 2.0" was the working label and
still use it. They are historical records and are left as written — the
decisions they contain are unchanged. Read "RecipeBox 2.0" in those documents as
"the native RecipeBox client".
