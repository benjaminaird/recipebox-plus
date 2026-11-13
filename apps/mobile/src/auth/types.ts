// The `/api/v1` contract as the client sees it. Shapes here must match
// docs/native-auth-design.md; a published build cannot be hot-fixed, so the
// rule is that the server may add fields and may never remove or rename one.

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  emailVerified: boolean;
  /**
   * When verification was actually proven. Null for accounts that predate the
   * feature and were backfilled to verified — they can sign in, but nobody
   * confirmed anything, and the app must not tell the person otherwise.
   */
  emailVerifiedAt: string | null;
};

export type DeviceDescriptor = {
  name: string;
  platform: "ios" | "android" | "unknown";
  installId: string;
};

export type DeviceSummary = {
  id: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

export type TokenPair = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  deviceId: string;
};

export type SignInResult = TokenPair & { user: AuthUser };

/**
 * Error codes the client switches on. An unknown code must be treated as a
 * generic failure rather than crashing — that is what keeps a v1 build working
 * against a server that has learned new ones.
 */
export type AuthErrorCode =
  | "invalid_credentials"
  | "email_verification_required"
  | "rate_limited"
  | "refresh_invalid"
  | "unauthorized"
  | "token_expired"
  | "device_not_found"
  | "device_limit_reached"
  | "email_taken"
  | "invalid_signup"
  | "email_unavailable"
  // Import (/api/v1/import/fetch). Each says something different about the
  // page, and the review screen says a different thing back.
  | "bad_url"
  | "not_html"
  | "too_large"
  | "blocked"
  | "upstream_timeout"
  | "upstream_unreachable"
  | "database_unavailable"
  | "not_found"
  | "server_error"
  /** A 2xx that was not JSON: not a RecipeBox v1 API at the other end. */
  | "unsupported_response"
  | "unknown";

export class AuthApiError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;
  readonly retryAfter: number | null;
  readonly verificationEmailSent: boolean;

  constructor(status: number, code: string, message: string, extra?: { retryAfter?: number; verificationEmailSent?: boolean }) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = KNOWN_CODES.has(code as AuthErrorCode) ? (code as AuthErrorCode) : "unknown";
    this.retryAfter = extra && typeof extra.retryAfter === "number" ? extra.retryAfter : null;
    this.verificationEmailSent = !!(extra && extra.verificationEmailSent);
  }
}

/**
 * A request that never reached the server, or an answer that was not the
 * server's. The distinction matters more than any other in this file: a
 * network failure must never sign anyone out, and only the server may say a
 * session is over.
 */
export class AuthNetworkError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AuthNetworkError";
    this.cause = cause;
  }
}

const KNOWN_CODES = new Set<AuthErrorCode>([
  "invalid_credentials",
  "email_verification_required",
  "rate_limited",
  "refresh_invalid",
  "unauthorized",
  "token_expired",
  "device_not_found",
  "device_limit_reached",
  "email_taken",
  "invalid_signup",
  "email_unavailable",
  "bad_url",
  "not_html",
  "too_large",
  "blocked",
  "upstream_timeout",
  "upstream_unreachable",
  "database_unavailable",
  "not_found",
  "server_error",
  "unsupported_response",
  "unknown",
]);
