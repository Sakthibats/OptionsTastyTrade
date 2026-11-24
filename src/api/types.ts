/**
 * tastytrade response shapes (kebab-case keys, as the API returns them).
 * Partial on purpose: add fields as you need them and confirm against a live
 * response — numeric fields often arrive as strings.
 */

export interface Items<T> {
  items: T[];
}

export interface NestedStrike {
  "strike-price": string;
  call: string;
  "call-streamer-symbol": string;
  put: string;
  "put-streamer-symbol": string;
}

export interface NestedExpiration {
  "expiration-type": string;
  "expiration-date": string; // YYYY-MM-DD
  "days-to-expiration": number;
  "settlement-type": string;
  strikes: NestedStrike[];
}

export interface NestedOptionChain {
  "underlying-symbol": string;
  "root-symbol": string;
  "option-chain-type": string;
  "shares-per-contract": number;
  expirations: NestedExpiration[];
}

export interface MarketMetric {
  symbol: string;
  "implied-volatility-index"?: string;
  "implied-volatility-index-rank"?: string;
  "implied-volatility-percentile"?: string;
  "liquidity-rating"?: number;
  beta?: string;
}

export interface QuoteToken {
  token: string;
  "dxlink-url": string;
  level: string;
}

/** GET /market-data/by-type?equity=SPY — REST snapshot, available when the market is closed. */
export interface MarketDataSnapshot {
  symbol: string;
  "instrument-type"?: string;
  bid?: string | number;
  ask?: string | number;
  mid?: string | number;
  mark?: string | number;
  last?: string | number;
  close?: string | number;
  "prev-close"?: string | number;
  "day-high-price"?: string | number;
  "day-low-price"?: string | number;
  "updated-at"?: string;
}

/** Our Worker's normalized Yahoo Finance fallback (worker/yahoo.ts). */
export interface YahooQuote {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  currency: string | null;
  time: number | null;
}
