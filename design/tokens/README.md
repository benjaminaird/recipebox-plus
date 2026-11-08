# RecipeBox design tokens

`recipebox.tokens.json` is the single source of truth for the Modern Cookbook
design system (ADR 0018) in its Light and Dark appearances (ADR 0019).

- **Colour:** every token has `light` and `dark` values and a written `role`.
  Components reference names (`textSecondary`, `accentSoft`), never values.
- **Contrast:** pairs listed under `contrast.pairs` must meet their minimum in
  both appearances. Check with:

  ```sh
  node scripts/design-tokens-check.js
  ```

  The script is read-only and has no dependencies.
- **Typography, space, radius, elevation, touch, motion, photography:** these
  are platform-neutral data, consumed by the React Native client.

This folder is outside anything the production web app builds or serves.
During M3 it moves into the monorepo as `packages/design-tokens`, which emits a
typed module for `apps/mobile`. The web app does not consume it today
(ADR 0005).

## Changing a token

1. Edit the value for **both** appearances. Never add a light-only or
   dark-only colour.
2. If the token carries text or marks a control, add or confirm its contrast
   pair.
3. Run the check script. It must pass.
4. Note the change and its reason in the commit message. If it changes the
   identity, for example the accent hue, it also needs an ADR 0018 amendment.
