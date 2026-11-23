import type { MarketDataSnapshot, YahooQuote } from "../api/types";
import type { MarketEvent } from "../streaming/dxlink";
import { num } from "./metrics";

/* ------------------------------------------------------------- US equity session */

export type Session = "pre" | "regular" | "post" | "closed";

export interface SessionInfo {
  session: Session;
  /** Minutes until the current session ends (pre/regular/post only, same day). */
  minutesLeft?: number;
}

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });

/**
 * NYSE/Nasdaq hours in New York time: pre 4:00–9:30, regular 9:30–16:00,
 * post 16:00–20:00, Mon–Fri. Exchange holidays and early closes are not modeled.
 */
export function usEquitySession(now = new Date()): SessionInfo {
  const parts = Object.fromEntries(ET.formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return { session: "closed" };
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const bands: Array<[Session, number, number]> = [
    ["pre", 4 * 60, 9 * 60 + 30],
    ["regular", 9 * 60 + 30, 16 * 60],
    ["post", 16 * 60, 20 * 60],
  ];
  for (const [session, start, end] of bands) {
    if (mins >= start && mins < end) return { session, minutesLeft: end - mins };
  }
  return { session: "closed" };
}

/* ------------------------------------------------------------- spot resolution */

export type SpotSource = "live quote" | "last trade" | "tastytrade snapshot" | "Yahoo Finance";

export interface Spot {
  price?: number;
  prevClose?: number;
  dayHigh?: number;
  dayLow?: number;
  source?: SpotSource;
  bid?: number;
  ask?: number;
}

/** A quote is "live enough" for mid-pricing when both sides exist and the spread is tight. */
const MAX_SPREAD = 0.005; // 0.5% of mid

/**
 * Best available underlying price, in order: tight live quote → last trade →
 * tastytrade REST snapshot → Yahoo Finance. When the market is closed the stream
 * often has empty or wide quotes, so the later sources fill in.
 */
export function resolveSpot(
  quote: MarketEvent | undefined,
  trade: MarketEvent | undefined,
  summary: MarketEvent | undefined,
  snapshot: MarketDataSnapshot | undefined,
  yahoo: YahooQuote | undefined,
): Spot {
  const bid = pos(quote?.bidPrice);
  const ask = pos(quote?.askPrice);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : undefined;
  const last = pos(trade?.price);
  const snap = pos(snapshot?.mark) ?? pos(snapshot?.last) ?? pos(snapshot?.mid) ?? pos(snapshot?.close);

  let price: number | undefined;
  let source: SpotSource | undefined;
  if (mid != null && (ask! - bid!) / mid <= MAX_SPREAD) [price, source] = [mid, "live quote"];
  else if (last != null) [price, source] = [last, "last trade"];
  else if (snap != null) [price, source] = [snap, "tastytrade snapshot"];
  else if (pos(yahoo?.price) != null) [price, source] = [yahoo!.price!, "Yahoo Finance"];
  else if (mid != null) [price, source] = [mid, "live quote"]; // wide, but better than nothing

  return {
    price,
    source,
    bid,
    ask,
    prevClose: pos(summary?.prevDayClosePrice) ?? pos(snapshot?.["prev-close"]) ?? pos(yahoo?.previousClose),
    dayHigh: pos(summary?.dayHighPrice) ?? pos(snapshot?.["day-high-price"]) ?? pos(yahoo?.dayHigh),
    dayLow: pos(summary?.dayLowPrice) ?? pos(snapshot?.["day-low-price"]) ?? pos(yahoo?.dayLow),
  };
}

function pos(v: unknown): number | undefined {
  const n = num(v);
  return n != null && n > 0 ? n : undefined;
}
