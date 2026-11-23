import { checkAccess } from "./access";
import type { Env } from "./env";
import { proxyToTastytrade } from "./proxy";
import { AuthConfigError, UpstreamAuthError } from "./tastytrade-auth";
import { yahooQuote } from "./yahoo";

/**
 * Thin backend for the static SPA. Static assets never reach this code (Cloudflare
 * serves them directly); only /api/* runs here (see wrangler.jsonc run_worker_first).
 *
 *   GET /api/health        → liveness, no auth
 *   GET /api/tt/<path>     → allowlisted, read-only proxy to the tastytrade API
 *   GET /api/yahoo/quote/X → fallback underlying price from Yahoo Finance (no credentials)
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const denied = await checkAccess(request, env);
    if (denied) return denied;

    try {
      if (url.pathname.startsWith("/api/tt/")) {
        return await proxyToTastytrade(request, env, url.pathname.slice("/api/tt".length));
      }
      if (url.pathname.startsWith("/api/yahoo/quote/") && request.method === "GET") {
        return await yahooQuote(decodeURIComponent(url.pathname.slice("/api/yahoo/quote/".length)).toUpperCase());
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    } catch (err) {
      if (err instanceof AuthConfigError) {
        return Response.json({ error: err.message }, { status: 500 });
      }
      if (err instanceof UpstreamAuthError) {
        return Response.json({ error: err.message }, { status: 502 });
      }
      console.error("unhandled", err instanceof Error ? err.message : "unknown error");
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
