// The server the app talks to, chosen at build time rather than committed.
//
// app.json holds everything that is the same in every build. The one value
// that is not is the API origin: a development build points at a laptop or a
// tailnet host, a release build points at the real thing, and a design-system
// build points at nothing at all. Keeping it in a tracked file meant editing
// that file between builds and hoping nobody committed the laptop's address;
// reading it from the environment means the build profile decides.
//
//   RECIPEBOX_API_BASE_URL=http://127.0.0.1:3100 npx expo start
//
// Unset is a deliberate, supported state, not a misconfiguration: with no
// origin the app says it has no sign-in server instead of sending a password
// somewhere that would not use it. That is why this falls back to app.json's
// empty string rather than to a default host.

import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const fromEnv = (process.env.RECIPEBOX_API_BASE_URL ?? "").trim();
  return {
    ...config,
    name: config.name ?? "RecipeBox",
    slug: config.slug ?? "recipebox",
    extra: {
      ...config.extra,
      apiBaseUrl: fromEnv || (config.extra?.apiBaseUrl ?? ""),
    },
  };
};
