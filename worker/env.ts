/** Bindings available to the Worker. Values come from wrangler.jsonc `vars`,
 *  Cloudflare secrets in production, or the local secrets file in `npm run dev`. */
export interface Env {
  ASSETS: Fetcher;

  // vars
  TT_API_BASE: string;
  USER_AGENT: string;
  AUTH_MODE: "access" | "none";
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;

  // secrets — must never be returned to the browser or logged
  TT_CLIENT_ID?: string;
  TT_CLIENT_SECRET: string;
  TT_REFRESH_TOKEN: string;
}
