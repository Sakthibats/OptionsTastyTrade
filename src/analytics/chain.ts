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

const rowsCache = new WeakMap<NestedExpiration, ChainRow[]>();
/** `toRows`, memoized per expiration object (the query cache keeps them stable). */
export function rowsOf(exp: NestedExpiration): ChainRow[] {
  let r = rowsCache.get(exp);
  if (!r) rowsCache.set(exp, (r = toRows(exp)));
  return r;
}

/**
 * Strikes for the strike ladder: everything within ±`sigmas` of spot (lognormal,
 * using `vol`), never fewer than `minEachSide` strikes on each side, thinned evenly
 * to at most `max` rows. `keep` (the selected strike) always survives thinning.
 */
export function ladderRows(rows: ChainRow[], spot: number, vol: number, t: number, opts: { sigmas?: number; minEachSide?: number; max?: number; keep?: number } = {}): ChainRow[] {
  const { sigmas = 2.5, minEachSide = 8, max = 41, keep } = opts;
  if (!rows.length) return [];
  const w = sigmas * vol * Math.sqrt(Math.max(t, 1 / 365));
  const lo = spot * Math.exp(-w);
  const hi = spot * Math.exp(w);
  const near = aroundSpot(rows, (r) => r.strike, spot, minEachSide);
  const kept = keep != null ? rows.find((r) => r.strike === keep) : undefined;
  const inRange = rows.filter((r) => (r.strike >= lo && r.strike <= hi) || near.includes(r) || r === kept);
  if (inRange.length <= max) return inRange;
  const step = inRange.length / max;
  const picked = new Set<ChainRow>();
  for (let i = 0; i < max; i++) picked.add(inRange[Math.min(inRange.length - 1, Math.round(i * step))]!);
  if (kept) picked.add(kept);
  return inRange.filter((r) => picked.has(r));
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
