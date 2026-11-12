// The /api/v1 client. One job: turn HTTP into either a value or one of two
// errors — AuthApiError (the server answered and refused) or AuthNetworkError
// (the server was never reached). Everything above this file depends on that
// distinction, because only the first may ever end a session.

import {
  AuthApiError,
  AuthNetworkError,
  type AuthUser,
  type DeviceDescriptor,
  type DeviceSummary,
  type SignInResult,
  type TokenPair,
} from "./types.ts";

export type FetchLike = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}) => Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type AuthApi = ReturnType<typeof createAuthApi>;

export type AuthApiOptions = {
  baseUrl: string;
  fetchImpl: FetchLike;
  /** Per-request timeout. A phone on a bad connection must not hang forever. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15000;

export function createAuthApi(options: AuthApiOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(path: string, init: { method?: string; body?: unknown; accessToken?: string } = {}): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.accessToken) headers.Authorization = "Bearer " + init.accessToken;

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await options.fetchImpl(base + path, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller ? controller.signal : undefined,
      });
    } catch (err) {
      // Never reached the server: offline, DNS, TLS, timeout. Not a rejection.
      throw new AuthNetworkError("Could not reach RecipeBox.", err);
    } finally {
      if (timer) clearTimeout(timer);
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.status >= 200 && response.status < 300) {
      // A 2xx that is not JSON is not a success. A server without /api/v1
      // answers the single-page app's HTML with a 200, and a captive portal
      // does much the same — both would otherwise arrive here as an empty
      // success and be read as a session.
      if (payload === null) {
        throw new AuthApiError(response.status, "unsupported_response", "That address did not answer as RecipeBox.");
      }
      return payload;
    }

    // A body that is not the JSON we expect — a proxy's HTML error page, say —
    // is still the server refusing us; it is not a network failure, and it must
    // not be reported as a code the client could mistake for a real one.
    const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    const code = typeof body.code === "string" ? body.code : "unknown";
    const message = typeof body.message === "string" ? body.message : "Something went wrong.";
    throw new AuthApiError(response.status, code, message, {
      retryAfter: typeof body.retryAfter === "number" ? body.retryAfter : undefined,
      verificationEmailSent: body.verificationEmailSent === true,
    });
  }

  return {
    baseUrl: base,

    async signIn(email: string, password: string, device: DeviceDescriptor): Promise<SignInResult> {
      return (await request("/api/v1/auth/signin", { method: "POST", body: { email, password, device } })) as SignInResult;
    },

    /** Create an account. Deliberately returns no tokens: a new account
     *  confirms its email before it can have a session. */
    async signUp(email: string, password: string, displayName: string): Promise<{ user: AuthUser; verificationRequired: boolean; verificationEmailSent: boolean }> {
      return (await request("/api/v1/auth/signup", { method: "POST", body: { email, password, displayName } })) as {
        user: AuthUser; verificationRequired: boolean; verificationEmailSent: boolean;
      };
    },

    async refresh(refreshToken: string): Promise<TokenPair & { user: AuthUser }> {
      return (await request("/api/v1/auth/refresh", { method: "POST", body: { refreshToken } })) as TokenPair & { user: AuthUser };
    },

    async signOut(input: { accessToken?: string; refreshToken?: string }): Promise<void> {
      await request("/api/v1/auth/signout", {
        method: "POST",
        accessToken: input.accessToken,
        body: input.refreshToken ? { refreshToken: input.refreshToken } : {},
      });
    },

    async me(accessToken: string): Promise<{ user: AuthUser }> {
      return (await request("/api/v1/me", { accessToken })) as { user: AuthUser };
    },

    async devices(accessToken: string): Promise<{ devices: DeviceSummary[] }> {
      return (await request("/api/v1/auth/devices", { accessToken })) as { devices: DeviceSummary[] };
    },

    async revokeDevice(accessToken: string, deviceId: string): Promise<void> {
      await request("/api/v1/auth/devices/" + encodeURIComponent(deviceId), { method: "DELETE", accessToken });
    },

    async resendVerification(email: string, password: string): Promise<void> {
      await request("/api/v1/auth/verification/send", { method: "POST", body: { email, password } });
    },

    /** Ask for a reset link. The link opens the web app, which is where the
     *  one password-reset mechanism lives. */
    async requestPasswordReset(email: string): Promise<void> {
      await request("/api/v1/auth/password-reset", { method: "POST", body: { email } });
    },

    /** Any authenticated call, for the surfaces that come later (sync, import). */
    async authorized(path: string, accessToken: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
      return request(path, { ...init, accessToken });
    },
  };
}
