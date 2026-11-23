# Options Analytics (tastytrade)

Personal options analytics webapp on the tastytrade API. A static React SPA does the
UI and the math. A tiny Cloudflare Worker only holds the OAuth secrets and proxies
read-only API calls. Both are served from one Cloudflare deploy on the free tier.

## Secrets: hard rules

- **Never read, print, grep, copy, or edit `.env`, `.env.*`, or `.dev.vars`.** They
  hold live brokerage credentials. `.claude/settings.json` (deny rules + sandbox) and
  `.claude/hooks/protect-secrets.sh` enforce this, so don't look for workarounds. If
  a task seems to need a secret value, stop and ask the user to do that step.
- Variable *names* live in `worker/env.ts` (source of truth) and `.env.example`. Claude
  can't read `.env.example` either, because the user's global deny rules cover it. When
  you add a variable, update `worker/env.ts` and ask the user to add it to `.env.example`.
- Never give a server secret a `VITE_` prefix. Vite bundles `VITE_*` into the browser.
- The browser must never receive the client secret, refresh token, or tastytrade
  access token. Only the DXLink quote token (market data only, 24h) goes to the client.
- Never log tokens or upstream auth response bodies in the Worker.
- Don't run `wrangler deploy` or `wrangler secret put`. The user does those.

## Architecture

```
browser (src/)  ──/api/tt/*──▶  Worker (worker/)  ──Bearer──▶  api.tastyworks.com
     │                           holds TT_CLIENT_SECRET, TT_REFRESH_TOKEN
     └──── wss (DXLink, quote token) ─────────────────────────▶ dxlink streamer
```

- `worker/index.ts`: routes. Only `/api/*` runs the Worker. Static files are served
  directly by Cloudflare (`run_worker_first` in `wrangler.jsonc`).
- `worker/tastytrade-auth.ts`: OAuth2 refresh-token → 15-min access token, cached per isolate.
- `worker/proxy.ts`: **GET-only allowlist** of tastytrade paths. Order/trade
  endpoints are intentionally unreachable. Adding a non-GET or order endpoint is a
  security decision: ask the user first, and never do it as a side effect of
  another task.
- `worker/yahoo.ts`: `/api/yahoo/quote/:symbol`, the last-resort underlying price
  (unofficial Yahoo chart API, no CORS, so it has to be proxied). Only a validated
  ticker leaves the Worker.
- `src/analytics/market.ts`: US session detection (holidays not modeled) and
  `resolveSpot()`. Price priority: tight live quote → last trade → tastytrade REST
  snapshot → Yahoo.
- `worker/access.ts`: verifies the Cloudflare Access JWT in production.
  `AUTH_MODE=none` is honored only on localhost.
- `src/api/`: `ttGet()` client (unwraps `{data}`), response types, TanStack Query hooks.
- `src/analytics/`: pure functions (Black-Scholes, greeks, IV, chain transforms).
  Put heavy preprocessing here, not in components. Keep it pure and unit-tested.
- `src/streaming/`: DXLink WebSocket client (COMPACT format) + `useMarketData` hook.
- `src/pages/`: UI. `src/components/ui.tsx` holds the shared controls (segmented,
  stat tile, heat legend, tooltip).
- `src/analytics/metrics.ts`: what the heatmap can color by, the heat scale (a
  6-step one-hue blue ramp with APCA-picked ink), and formatters.
- `src/demo.ts`: `?demo` mode with simulated chain and stream data. Use it for UI
  work and screenshots, never real account data. Headless check:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot=… --window-size=1400,900 "http://localhost:5173/?demo"`

## Conventions

- TypeScript strict. tastytrade JSON keys are kebab-case. Keep them as-is in
  `src/api/types.ts` and map them to camelCase in `src/analytics` when needed.
  Numeric fields often arrive as strings, so convert with `Number()`.
- Prefer computing in the browser (free) over the Worker (request-metered). Use the
  Worker only for things that need secrets or must hide something from the client.
- Before calling a new tastytrade endpoint, check https://developer.tastytrade.com/reference/
  and add it to the allowlist in `worker/proxy.ts`, with a test in `worker/proxy.test.ts`.

## Commands

Node ≥ 22.12 (`nvm use`).

- `npm run dev`: Vite + Worker on one origin (http://localhost:5173). Needs no Cloudflare account
- `npm test`: vitest (analytics, DXLink parser, proxy allowlist)
- `npm run typecheck`, `npm run build`
- `npm run deploy`: **user only**

Run `npm test && npm run typecheck` before calling a change done.

## Claude Code sandbox notes

Bash runs sandboxed. `npm install` (writes `~/.npm`) and `npm run dev` (binds a
port) fail inside it. Retry those outside the sandbox through the permission prompt.
Never request reads of secret files.
