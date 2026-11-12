// Where the app looks for a RecipeBox server.
//
// Configuration, not a constant, because a development build points at a
// laptop and a release build points at the real thing — and because a build
// with no server configured should say so rather than fail in a way that looks
// like a wrong password.

import Constants from "expo-constants";

export function apiBaseUrl(): string | null {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const configured = extra?.apiBaseUrl;
  if (typeof configured !== "string") return null;
  const trimmed = configured.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

/** This device, as the server's device list will show it. */
export function deviceName(): string {
  const name = Constants.deviceName;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : "RecipeBox app";
}
