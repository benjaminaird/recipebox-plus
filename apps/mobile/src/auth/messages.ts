// What a failure says to a cook.
//
// Kept apart from the screens, and pure, because this is where a careless
// sentence does real damage. Two rules:
//
//   Never answer a question that was not asked. "No account with that email"
//   is friendlier and tells anyone who types an address whether it belongs to
//   someone. Sign-in and reset failures are deliberately uninformative about
//   which part was wrong.
//
//   Never frighten someone about their recipes. Every message that could be
//   read as "your cookbook is gone" says what is actually true: the recipes
//   are on the device and nothing has happened to them.

import { AuthApiError, AuthNetworkError } from "./types.ts";

export type Tone = "info" | "attention" | "danger";

export type Message = {
  title: string;
  detail?: string;
  tone: Tone;
  /** The server told us how long to wait, in seconds. */
  retryAfter?: number;
};

export type ErrorContext = "signin" | "signup" | "verify" | "reset" | "session" | "devices";

function waitMinutes(seconds: number | null): string {
  if (!seconds || seconds <= 60) return "in a minute";
  const minutes = Math.ceil(seconds / 60);
  return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function describeAuthError(err: unknown, context: ErrorContext): Message {
  if (err instanceof AuthNetworkError) {
    return {
      title: "No connection",
      detail: context === "session"
        ? "RecipeBox will reconnect on its own. Your recipes are on this device and still work."
        : "RecipeBox could not reach the server. Your recipes are on this device and still work.",
      tone: "attention",
    };
  }

  if (!(err instanceof AuthApiError)) {
    return { title: "Something went wrong", detail: "Try again in a moment.", tone: "danger" };
  }

  switch (err.code) {
    case "invalid_credentials":
      // One message for a wrong password and for an address with no account.
      return { title: "Email or password did not match", detail: "Check both and try again.", tone: "danger" };

    case "email_verification_required":
      return {
        title: "Confirm your email first",
        detail: err.verificationEmailSent
          ? "We have sent you a new confirmation link. Open it, then come back and sign in."
          : "Open the confirmation link we sent when the account was created, then sign in.",
        tone: "attention",
      };

    case "email_taken":
      return { title: "That email already has an account", detail: "Sign in instead, or use a different address.", tone: "attention" };

    case "invalid_signup":
      // The server's own wording here is a rule about what it will accept —
      // safe to repeat, and more useful than anything written in advance.
      return { title: err.message, tone: "danger" };

    case "rate_limited":
      return {
        title: "Too many attempts",
        detail: `Wait ${waitMinutes(err.retryAfter)} and try again.`,
        tone: "attention",
        retryAfter: err.retryAfter ?? undefined,
      };

    case "refresh_invalid":
    case "unauthorized":
    case "token_expired":
      return {
        title: "Your session has ended",
        detail: "Sign in again to reconnect. Nothing on this device has changed.",
        tone: "attention",
      };

    case "device_not_found":
      return { title: "That device is already signed out", tone: "info" };

    case "device_limit_reached":
      return { title: "Too many signed-in devices", detail: "Sign one out from another device and try again.", tone: "attention" };

    case "email_unavailable":
      return {
        title: "This server cannot send email yet",
        detail: "Password reset needs email delivery, which is not configured here.",
        tone: "attention",
      };

    case "database_unavailable":
      return { title: "RecipeBox is unavailable", detail: "The server is not accepting sign-ins right now. Try again shortly.", tone: "attention" };

    case "not_found":
    case "unsupported_response":
      return {
        title: "No sign-in server",
        detail: "This copy of RecipeBox is not connected to a RecipeBox account server. Everything on this device keeps working.",
        tone: "attention",
      };

    default:
      return { title: "Something went wrong", detail: "Try again in a moment.", tone: "danger" };
  }
}

/** What the screen says while the session is stale rather than ended. */
export function staleMessage(persistent: boolean): Message {
  return {
    title: "Signed in, but offline",
    detail: persistent
      ? "RecipeBox cannot reach the server. It will reconnect by itself; your recipes are here either way."
      : "RecipeBox cannot reach the server, and this build cannot store your session securely, so you will sign in again next launch.",
    tone: "attention",
  };
}
