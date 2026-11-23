import type { Env } from "./env";

/**
 * tastytrade OAuth2 (personal grant): exchange the long-lived refresh token for a
 * 15-minute access token. Docs: https://developer.tastytrade.com/docs/authentication/oauth2/
 *
 * The token is cached per Worker isolate. Isolates are short-lived, so this
 * refreshes at most every ~15 min per isolate — far below any rate limit.
 */

interface CachedToken {
  value: string;
  expiresAt: number; // epoch ms
}

let cached: CachedToken | null = null;
let inflight: Promise<string> | null = null;

const EARLY_REFRESH_MS = 60_000;

export async function getAccessToken(env: Env, opts: { force?: boolean } = {}): Promise<string> {
  if (!opts.force && cached && Date.now() < cached.expiresAt - EARLY_REFRESH_MS) {
    return cached.value;
  }
  // Coalesce concurrent refreshes into one request.
  inflight ??= refresh(env).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function refresh(env: Env): Promise<string> {
  if (!env.TT_CLIENT_SECRET || !env.TT_REFRESH_TOKEN) {
    throw new AuthConfigError("TT_CLIENT_SECRET / TT_REFRESH_TOKEN are not configured");
  }

  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: env.TT_REFRESH_TOKEN,
    client_secret: env.TT_CLIENT_SECRET,
  };
  if (env.TT_CLIENT_ID) body.client_id = env.TT_CLIENT_ID;

  const res = await fetch(`${env.TT_API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": env.USER_AGENT,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Deliberately do not echo the response body: keep anything credential-shaped out of logs.
    cached = null;
    throw new UpstreamAuthError(`tastytrade token refresh failed: HTTP ${res.status}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new UpstreamAuthError("tastytrade token response had no access_token");

  const ttlMs = (json.expires_in ?? 900) * 1000;
  cached = { value: json.access_token, expiresAt: Date.now() + ttlMs };
  return cached.value;
}

export function invalidateAccessToken(): void {
  cached = null;
}

export class AuthConfigError extends Error {}
export class UpstreamAuthError extends Error {}
