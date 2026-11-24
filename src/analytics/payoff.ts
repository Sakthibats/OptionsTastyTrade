/**
 * Payoff, breakeven, probability and yield math for option positions.
 *
 * A position is a list of legs, so spreads and condors reuse everything here; the
 * Strategy page currently builds one-leg positions (long/short call/put).
 *
 * Units: prices per share; multiply by MULTIPLIER for one contract. `t` in years.
 * Probabilities are risk-neutral lognormal (Black-Scholes world) using the given
 * implied vol: a market-implied estimate, not a forecast.
 */
import { intrinsic, price as bsPrice, normCdf, type OptionType } from "./blackScholes";

export const MULTIPLIER = 100;

export type Strategy = "long-call" | "short-call" | "long-put" | "short-put";

export interface StrategyDef {
  label: string;
  type: OptionType;
  /** +1 buy, -1 sell. */
  dir: 1 | -1;
  view: string;
  blurb: string;
}

export const STRATEGIES: Record<Strategy, StrategyDef> = {
  "long-call": { label: "Long call", type: "call", dir: 1, view: "Bullish", blurb: "Pay a premium for upside. Most you can lose is the premium." },
  "short-call": { label: "Short call", type: "call", dir: -1, view: "Neutral to bearish", blurb: "Collect a premium. Loss is unlimited unless you own the shares." },
  "long-put": { label: "Long put", type: "put", dir: 1, view: "Bearish", blurb: "Pay a premium for downside, or to insure shares you own." },
  "short-put": { label: "Short put", type: "put", dir: -1, view: "Neutral to bullish", blurb: "Collect a premium. You may have to buy shares at the strike." },
};

export interface Leg {
  type: OptionType;
  /** Signed contracts: +2 = long two, -1 = short one. */
  qty: number;
  strike: number;
  /** Entry price per share, always positive (debit if long, credit if short). */
  premium: number;
  /** Implied vol used to price the leg before expiry. */
  iv: number;
  /** Years from now until this leg expires. */
  t: number;
}

export interface Scenario {
  /** Days from now at which to value the position. */
  daysForward: number;
  /** Relative IV change: 0.1 = every leg's IV × 1.1. */
  ivShift: number;
  rate: number;
}

/** P/L per share (summed over legs, times qty) if held to expiration at underlying price `s`. */
export function pnlAtExpiry(legs: Leg[], s: number): number {
  let sum = 0;
  for (const l of legs) sum += l.qty * (intrinsic(l.type, s, l.strike) - l.premium);
  return sum;
}

/** P/L per share at `daysForward` days from now, marking each leg with Black-Scholes. */
export function pnlAt(legs: Leg[], s: number, { daysForward, ivShift, rate }: Scenario): number {
  let sum = 0;
  for (const l of legs) {
    const t = Math.max(0, l.t - daysForward / 365);
    const vol = Math.max(0.01, l.iv * (1 + ivShift));
    sum += l.qty * (bsPrice({ type: l.type, spot: s, strike: l.strike, t, vol, rate }) - l.premium);
  }
  return sum;
}

/** Slope of the expiry payoff above the highest strike (calls contribute, puts are flat). */
function slopeAbove(legs: Leg[]): number {
  return legs.reduce((s, l) => s + (l.type === "call" ? l.qty : 0), 0);
}

function kinks(legs: Leg[]): number[] {
  return [0, ...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
}

/**
 * Underlying prices where the expiry P/L crosses zero, ascending. The expiry
 * payoff is piecewise linear with kinks at the strikes, so this is exact.
 */
export function breakevens(legs: Leg[]): number[] {
  if (!legs.length) return [];
  const ks = kinks(legs);
  const out: number[] = [];
  const push = (x: number) => {
    if (x > 0 && !out.some((o) => Math.abs(o - x) < 1e-9)) out.push(x);
  };
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i]!;
    const b = ks[i + 1]!;
    const fa = pnlAtExpiry(legs, a);
    const fb = pnlAtExpiry(legs, b);
    if (fa === 0) push(a);
    if (fa * fb < 0) push(a + ((b - a) * fa) / (fa - fb));
  }
  const last = ks[ks.length - 1]!;
  const fl = pnlAtExpiry(legs, last);
  const m = slopeAbove(legs);
  if (fl === 0) push(last);
  else if (m !== 0 && Math.sign(fl) !== Math.sign(m)) push(last - fl / m);
  return out.sort((a, b) => a - b);
}

/** Best and worst expiry P/L per share. ±Infinity when unbounded. */
export function extremes(legs: Leg[]): { maxProfit: number; maxLoss: number } {
  const vals = kinks(legs).map((k) => pnlAtExpiry(legs, k));
  const m = slopeAbove(legs);
  return {
    maxProfit: m > 0 ? Infinity : Math.max(...vals),
    maxLoss: m < 0 ? -Infinity : Math.min(...vals),
  };
}

/** Risk-neutral lognormal probability that the underlying finishes above `x`. */
export function probAbove(spot: number, x: number, vol: number, t: number, rate: number): number {
  if (!(x > 0)) return 1;
  if (!Number.isFinite(x)) return 0;
  if (t <= 0 || vol <= 0) return spot > x ? 1 : 0;
  const d2 = (Math.log(spot / x) + (rate - 0.5 * vol * vol) * t) / (vol * Math.sqrt(t));
  return normCdf(d2);
}

/** Probability the position is profitable at expiration (P/L > 0). */
export function probOfProfit(legs: Leg[], spot: number, vol: number, t: number, rate: number): number {
  if (!legs.length) return 0;
  const edges = [0, ...breakevens(legs), Infinity];
  let p = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i]!;
    const b = edges[i + 1]!;
    const probe = Number.isFinite(b) ? (a + b) / 2 : a * 1.5 + 1;
    if (pnlAtExpiry(legs, probe) > 0) p += probAbove(spot, a, vol, t, rate) - probAbove(spot, b, vol, t, rate);
  }
  return Math.min(1, Math.max(0, p));
}

/** Lognormal ±k-sigma price range: [S·e^(−kσ√t), S·e^(kσ√t)]. */
export function sigmaRange(spot: number, vol: number, t: number, k = 1): [number, number] {
  const w = k * vol * Math.sqrt(Math.max(t, 0));
  return [spot * Math.exp(-w), spot * Math.exp(w)];
}

/**
 * Capital a single-leg trade ties up, per share, used as the denominator for
 * "return". Buyers: the premium paid. Short put: the strike (cash-secured).
 * Short call: the share price (covered by 100 shares you own).
 */
export function capitalBasis(strategy: Strategy, strike: number, premium: number, spot: number): { perShare: number; label: string } {
  switch (strategy) {
    case "long-call":
    case "long-put":
      return { perShare: premium, label: "premium paid" };
    case "short-put":
      return { perShare: strike, label: "cash secured at the strike" };
    case "short-call":
      return { perShare: spot, label: "100 shares held (covered)" };
  }
}

export function singleLeg(strategy: Strategy, strike: number, premium: number, iv: number, t: number, contracts = 1): Leg {
  const d = STRATEGIES[strategy];
  return { type: d.type, qty: d.dir * contracts, strike, premium, iv, t };
}

/* ---------------------------------------------------------------- strike ladder */

export interface LadderQuote {
  strike: number;
  premium: number;
  iv: number;
  delta?: number;
}

export interface LadderRow extends LadderQuote {
  breakeven: number;
  /** (breakeven − spot) / spot: how far the underlying can (seller) or must (buyer) move. */
  distance: number;
  pop: number;
  /**
   * Sellers: return on capital if the underlying is unchanged at expiration (the
   * premium you keep after any intrinsic value; equals `maxRet` when out of the
   * money). Buyers: return on the premium if the underlying finishes exactly at
   * the 1σ target in the trade's direction.
   */
  ret: number;
  /** Sellers only: `ret` scaled to a year (simple, not compounded). */
  annualized?: number;
  /** Sellers only: premium / capital, the most the trade can return. */
  maxRet?: number;
}

/**
 * One row per strike for a one-leg strategy: the trade-off between how far the
 * breakeven sits from spot, the chance of profit, and the return. `atmVol` sets
 * the 1σ target for buyers, so every strike is judged against the same move.
 */
export function strikeLadder(strategy: Strategy, quotes: LadderQuote[], spot: number, t: number, rate: number, atmVol: number): LadderRow[] {
  const d = STRATEGIES[strategy];
  const [lo1, hi1] = sigmaRange(spot, atmVol, t, 1);
  const target = d.type === "call" ? hi1 : lo1;
  const days = t * 365;

  return quotes
    .filter((q) => q.premium > 0 && q.iv > 0)
    .map((q) => {
      const leg = singleLeg(strategy, q.strike, q.premium, q.iv, t);
      const breakeven = d.type === "call" ? q.strike + q.premium : q.strike - q.premium;
      const pop = probOfProfit([leg], spot, q.iv, t, rate);
      if (d.dir > 0) {
        return { ...q, breakeven, distance: breakeven / spot - 1, pop, ret: pnlAtExpiry([leg], target) / q.premium };
      }
      const capital = capitalBasis(strategy, q.strike, q.premium, spot).perShare;
      const ret = pnlAtExpiry([leg], spot) / capital;
      return { ...q, breakeven, distance: breakeven / spot - 1, pop, ret, maxRet: q.premium / capital, annualized: days >= 1 ? (ret * 365) / days : undefined };
    });
}
