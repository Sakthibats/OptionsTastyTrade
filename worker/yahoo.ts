/**
 * Fallback quote from Yahoo Finance's public chart endpoint, used only when
 * tastytrade has no usable price (stream down, or market closed with empty quotes).
 *
 * Unofficial API: no key, no SLA, and it may change or rate-limit without notice.
 * It must go through the Worker because Yahoo sends no CORS headers. Only the
 * ticker leaves the Worker; no account data or credentials are involved.
 */

const SYMBOL = /^[A-Z0-9.^=-]{1,15}$/;

export interface YahooQuote {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  currency: string | null;
  /** Epoch ms of the last regular-session trade. */
  time: number | null;
}

export function isValidYahooSymbol(s: string): boolean {
  return SYMBOL.test(s);
}

export async function yahooQuote(symbol: string): Promise<Response> {
  if (!isValidYahooSymbol(symbol)) {
    return Response.json({ error: "Invalid symbol" }, { status: 400 });
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    cf: { cacheTtl: 15, cacheEverything: true },
  });
  if (!res.ok) {
    return Response.json({ error: `Yahoo Finance HTTP ${res.status}` }, { status: 502 });
  }

  const body = (await res.json()) as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } };
  const meta = body.chart?.result?.[0]?.meta;
  if (!meta) return Response.json({ error: "No quote from Yahoo Finance" }, { status: 404 });

  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const quote: YahooQuote = {
    symbol,
    price: n(meta.regularMarketPrice),
    previousClose: n(meta.previousClose) ?? n(meta.chartPreviousClose),
    dayHigh: n(meta.regularMarketDayHigh),
    dayLow: n(meta.regularMarketDayLow),
    currency: typeof meta.currency === "string" ? meta.currency : null,
    time: n(meta.regularMarketTime) != null ? n(meta.regularMarketTime)! * 1000 : null,
  };
  return Response.json({ data: quote }, { headers: { "Cache-Control": "no-store" } });
}
