import type { Env } from "./env";
import { getAccessToken, invalidateAccessToken } from "./tastytrade-auth";

/**
 * Read-only allowlist of tastytrade endpoints the browser may call via
 * /api/tt/<path>. GET only: order placement/cancel and other mutations are
 * deliberately unreachable. Adding a write endpoint is a security decision for
 * the repo owner, not a refactor (see CLAUDE.md).
 *
 * Reference: https://developer.tastytrade.com/reference/
 */
const SYM = "[A-Za-z0-9.]+"; // equities like AAPL, BRK.B
const ACCT = "[A-Za-z0-9]+";

export const ALLOWED_GET_PATHS: RegExp[] = [
  /^\/customers\/me\/accounts$/,
  new RegExp(`^/accounts/${ACCT}/(positions|balances)$`),
  new RegExp(`^/accounts/${ACCT}/transactions$`),
  new RegExp(`^/option-chains/${SYM}(/nested|/compact)?$`),
  /^\/market-metrics$/, // ?symbols=AAPL,SPY — IV rank, IV percentile, etc.
  /^\/market-data\/by-type$/,
  new RegExp(`^/instruments/equities/${SYM}$`),
  new RegExp(`^/symbols/search/${SYM}$`),
  /^\/api-quote-tokens$/, // DXLink streaming token (market data only, 24h)
];

export function isAllowed(method: string, path: string): boolean {
  if (method !== "GET") return false;
  if (path.includes("..") || path.includes("//")) return false;
  return ALLOWED_GET_PATHS.some((re) => re.test(path));
}

export async function proxyToTastytrade(request: Request, env: Env, ttPath: string): Promise<Response> {
  if (!isAllowed(request.method, ttPath)) {
    return Response.json({ error: `Not allowed: ${request.method} ${ttPath}` }, { status: 403 });
  }

  const search = new URL(request.url).search;
  const target = `${env.TT_API_BASE}${ttPath}${search}`;

  const call = async (token: string) =>
    fetch(target, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": env.USER_AGENT,
      },
    });

  let upstream = await call(await getAccessToken(env));
  if (upstream.status === 401) {
    invalidateAccessToken();
    upstream = await call(await getAccessToken(env, { force: true }));
  }

  // Pass through body + status, but only safe headers (no cookies, no upstream auth hints).
  const headers = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    "Cache-Control": "no-store",
  });
  return new Response(upstream.body, { status: upstream.status, headers });
}
