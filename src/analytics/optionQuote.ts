import type { MarketEvent } from "../streaming/dxlink";
import { greeks, impliedVol, RISK_FREE_RATE, type OptionType } from "./blackScholes";
import { num } from "./metrics";

/** Everything the UI needs about one option contract, merged from the DXLink events. */
export interface OptionQuote {
  bid?: number;
  ask?: number;
  mid?: number;
  /** Streamed theoretical price (Greeks event). Used when there is no two-sided quote. */
  theo?: number;
  iv?: number;
  delta?: number;
  /** Per share per calendar day. */
  theta?: number;
  openInterest?: number;
  volume?: number;
  /** IV/delta were estimated locally from the mid because the stream sent no greeks. */
  estimated: boolean;
  itm: boolean;
}

export function optionQuote(
  latest: Map<string, MarketEvent>,
  streamer: string,
  type: OptionType,
  strike: number,
  spot: number | undefined,
  t: number,
): OptionQuote {
  const q = latest.get(`Quote:${streamer}`);
  const g = latest.get(`Greeks:${streamer}`);
  const bid = positive(q?.bidPrice);
  const ask = positive(q?.askPrice);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : undefined;
  let iv = positive(g?.volatility);
  let delta = num(g?.delta) ?? undefined;
  let theta = num(g?.theta) ?? undefined;
  let estimated = false;

  if ((iv == null || delta == null) && spot && t > 0 && mid != null) {
    const vol = impliedVol(mid, { type, spot, strike, t, rate: RISK_FREE_RATE });
    if (Number.isFinite(vol)) {
      const est = greeks({ type, spot, strike, t, vol, rate: RISK_FREE_RATE });
      iv ??= vol;
      delta ??= est.delta;
      theta ??= est.theta;
      estimated = true;
    }
  }

  return {
    bid,
    ask,
    mid,
    theo: positive(g?.price),
    iv,
    delta,
    theta,
    openInterest: num(latest.get(`Summary:${streamer}`)?.openInterest) ?? undefined,
    volume: num(latest.get(`Trade:${streamer}`)?.dayVolume) ?? undefined,
    estimated,
    itm: spot != null && (type === "call" ? strike < spot : strike > spot),
  };
}

export type Fill = "mid" | "natural";

/**
 * Entry price per share. "natural" buys at the ask and sells at the bid; "mid" uses
 * the midpoint. Falls back to the streamed theoretical price when the book is empty
 * (common when the market is closed).
 */
export function entryPrice(q: OptionQuote, dir: 1 | -1, fill: Fill): { price?: number; theo: boolean } {
  const live = fill === "mid" ? q.mid : dir > 0 ? q.ask : q.bid;
  if (live != null) return { price: live, theo: false };
  return { price: q.theo, theo: q.theo != null };
}

export function positive(v: unknown): number | undefined {
  const n = num(v);
  return n != null && n > 0 ? n : undefined;
}
