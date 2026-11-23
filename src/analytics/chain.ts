import type { NestedExpiration } from "../api/types";

/** One strike row of a chain, flattened for tables and streaming subscriptions. */
export interface ChainRow {
  strike: number;
  callSymbol: string;
  putSymbol: string;
  callStreamer: string;
  putStreamer: string;
}

export function toRows(exp: NestedExpiration): ChainRow[] {
  return exp.strikes
    .map((s) => ({
      strike: Number(s["strike-price"]),
      callSymbol: s.call,
      putSymbol: s.put,
      callStreamer: s["call-streamer-symbol"],
      putStreamer: s["put-streamer-symbol"],
    }))
    .sort((a, b) => a.strike - b.strike);
}

/** Keep the `n` items on each side of the one closest to spot (chains can have hundreds of strikes). */
export function aroundSpot<T>(items: T[], strikeOf: (t: T) => number, spot: number | undefined, n: number): T[] {
  if (items.length <= 2 * n + 1) return items;
  // Before the first quote arrives, center on the middle of the chain.
  let atm = Math.floor(items.length / 2);
  if (spot) {
    atm = 0;
    for (let i = 1; i < items.length; i++) {
      if (Math.abs(strikeOf(items[i]!) - spot) < Math.abs(strikeOf(items[atm]!) - spot)) atm = i;
    }
  }
  const start = Math.max(0, Math.min(atm - n, items.length - (2 * n + 1)));
  return items.slice(start, start + 2 * n + 1);
}

export const nearTheMoney = (rows: ChainRow[], spot: number | undefined, n = 15) =>
  aroundSpot(rows, (r) => r.strike, spot, n);

/** Strike × expiration grid for the heatmap view. */
export interface Lattice {
  strikes: number[];
  columns: Array<{ date: string; dte: number; weekly: boolean; byStrike: Map<number, ChainRow> }>;
}

export function buildLattice(exps: NestedExpiration[], spot: number | undefined, n: number): Lattice {
  const columns = exps.map((e) => ({
    date: e["expiration-date"],
    dte: e["days-to-expiration"],
    weekly: e["expiration-type"] !== "Regular",
    byStrike: new Map(toRows(e).map((r) => [r.strike, r])),
  }));
  const all = [...new Set(columns.flatMap((c) => [...c.byStrike.keys()]))].sort((a, b) => a - b);
  return { strikes: aroundSpot(all, (k) => k, spot, n), columns };
}
