import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";

/**
 * Gate every /api request. This Worker holds credentials to a brokerage account,
 * so an unauthenticated public URL would let anyone read it.
 *
 * Production: Cloudflare Access (free for small teams) sits in front of the app and
 * adds a signed `Cf-Access-Jwt-Assertion` header; we verify it here as well, so a
 * misconfigured Access policy fails closed instead of open.
 *
 * Local dev: AUTH_MODE=none, honored only for localhost requests.
 */

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function checkAccess(request: Request, env: Env): Promise<Response | null> {
  const host = new URL(request.url).hostname;

  if (env.AUTH_MODE === "none") {
    return LOCAL_HOSTS.has(host) ? null : deny(403, "AUTH_MODE=none is only allowed on localhost");
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return deny(503, "Cloudflare Access is not configured (ACCESS_TEAM_DOMAIN / ACCESS_AUD)");
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return deny(401, "Missing Cloudflare Access token");

  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }

  try {
    await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD });
    return null;
  } catch {
    return deny(403, "Invalid Cloudflare Access token");
  }
}

function deny(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
