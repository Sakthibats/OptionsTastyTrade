# Options Analytics

A personal options analytics webapp on the [tastytrade API](https://developer.tastytrade.com/).
It's a static React frontend with a tiny Cloudflare Worker that holds your credentials.
Hosting fits in Cloudflare's free tier.

## Why not a purely static site?

tastytrade uses OAuth2. To get an access token you send your **client secret and
refresh token**. Anything in a static bundle is public, and a refresh token never
expires, so putting it in the browser would hand your brokerage account to anyone
who opens DevTools. The Worker is about 150 lines. It keeps the secrets
server-side, refreshes tokens, and avoids CORS issues because everything is
same-origin. Everything else (UI, greeks, IV, chain processing) runs in the browser.

| Option | Cost | Secrets safe | Notes |
|---|---|---|---|
| **Cloudflare Workers + static assets** (this repo) | Free: static requests are free, plus 100k Worker requests/day | ✅ | One deploy; Access login free for small teams |
| Static host + Vercel/Netlify functions | Free tier | ✅ | Same idea, two products |
| Pure static, token pasted in browser | Free | ❌ | Refresh token in localStorage; any XSS = account access |
| Container (Cloud Run, Fly, etc.) | Paid / sleeps | ✅ | Only needed for long-running jobs |
| Run locally only (`npm run dev`) | Free | ✅ | Fine if you only use it on your Mac |

## Setup

1. **Node 22+**: `nvm install && nvm use`
2. **Install**: `npm install`
3. **tastytrade OAuth app**: at my.tastytrade.com go to Manage → My Profile → API →
   OAuth Applications. Create an app, then **Create Grant** to get a refresh token.
   Grant **read** scope only. This app never needs to trade, and a read-only token
   limits the damage if it ever leaks.
4. **Local secrets** (do this yourself; Claude is blocked from this file):
   ```sh
   cp .env.example .env
   # edit .env: TT_CLIENT_SECRET, TT_REFRESH_TOKEN (TT_CLIENT_ID optional)
   ```
5. **Run**: `npm run dev` and open http://localhost:5173

**No credentials yet?** Open http://localhost:5173/?demo for simulated data
(Black-Scholes prices, synthetic open interest and volume). `?demo&view=heatmap`
and `?demo&page=positions` open the other views directly.

Local dev needs no Cloudflare account. The Worker runs inside the Vite dev server,
and secrets stay in `.env` on your machine.

### Troubleshooting local dev

| You see | Cause / fix |
|---|---|
| `503 Cloudflare Access is not configured` | `AUTH_MODE=none` is missing from `.env` |
| `500 TT_CLIENT_SECRET / TT_REFRESH_TOKEN are not configured` | Empty values in `.env`, or `.env` isn't in the project root. Restart `npm run dev` after editing it |
| `502 tastytrade token refresh failed: HTTP 401` | Wrong secret/refresh token, or prod credentials used against `TT_API_BASE` set to sandbox (or vice versa) |
| `403` from tastytrade on an endpoint | The grant lacks the scope for it (read is enough for everything here) |
| `stream: token error` | `/api-quote-tokens` needs a fully onboarded (funded) account; sandbox gives delayed data only |
| Chain loads but bid/ask stay `–` | DXLink connected but field layout differs. Check the browser console and `src/streaming/dxlink.ts` |

## Deploy (later, optional; Cloudflare free tier)

```sh
npx wrangler login
npx wrangler secret put TT_CLIENT_SECRET
npx wrangler secret put TT_REFRESH_TOKEN
npm run deploy
```

Then **put Cloudflare Access in front of it**. Until you do, the API returns 503
(fails closed):

1. Cloudflare dashboard → Zero Trust → Access → Applications → add a self-hosted app
   for your `*.workers.dev` URL (or custom domain). Allow only your email.
2. Copy the team domain (`yourteam.cloudflareaccess.com`) and the Application
   Audience (AUD) tag into `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in `wrangler.jsonc`.
   Redeploy.

## How Claude Code is kept away from your secrets

There are three layers, all in `.claude/`:

1. **Permission deny rules** (`settings.json`): the Read/Edit/Write/Grep tools refuse `.env*` and `.dev.vars*`.
2. **OS sandbox for Bash** (`settings.json` → `sandbox.filesystem.denyRead`):
   `cat .env`, `node -e "readFileSync('.env')"` and similar commands get
   "operation not permitted" from macOS itself.
3. **PreToolUse hook** (`hooks/protect-secrets.sh`): blocks any tool call that
   mentions those files and explains why. This includes commands Claude might run
   outside the sandbox.

Limits to know about:

- **Code Claude writes runs with your secrets.** `npm run dev` loads `.env` into the
  Worker. If Claude wrote code that logs a secret and then ran it, the value could
  end up in output. CLAUDE.md forbids this. Review diffs to `worker/` and approve
  unsandboxed commands carefully.
- When a command fails in the sandbox, Claude can ask to re-run it unsandboxed.
  You'll get a permission prompt. Layers 1 and 3 still apply then. To forbid
  unsandboxed retries entirely, add `"allowUnsandboxedCommands": false` under
  `sandbox`. You'd then have to run `npm install` / `npm run dev` yourself.
- For the strongest isolation, keep secrets in a password manager and inject them
  at run time, e.g. 1Password `op run --env-file=… -- npm run dev`. Then no
  plaintext secrets file exists at all.
- In production the secrets live only in Cloudflare (`wrangler secret put`), never on disk.

## Project layout

```
worker/            Cloudflare Worker: OAuth token refresh, Access check, read-only proxy
src/api/           fetch client, tastytrade types, TanStack Query hooks
src/analytics/     Black-Scholes, greeks, implied vol, chain transforms (pure + tested)
src/streaming/     DXLink WebSocket client for live quotes/greeks
src/pages/         Option chain, Positions
.claude/           Claude Code settings + secret-protection hook
```

## Status

The chain and positions views are wired to real endpoint shapes but **not yet
verified against a live account**. Check `src/api/types.ts` and the DXLink field
order against your first real responses.
