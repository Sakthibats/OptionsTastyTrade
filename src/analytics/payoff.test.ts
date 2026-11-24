import { describe, expect, it } from "vitest";
import { price } from "./blackScholes";
import { breakevens, capitalBasis, extremes, pnlAt, pnlAtExpiry, probAbove, probOfProfit, sigmaRange, singleLeg, strikeLadder, type Leg } from "./payoff";

const RATE = 0.045;
const T = 30 / 365;

describe("single-leg payoffs at expiration", () => {
  it("long call: loses the premium below the strike, gains above the breakeven", () => {
    const leg = singleLeg("long-call", 100, 3, 0.2, T);
    expect(pnlAtExpiry([leg], 90)).toBe(-3);
    expect(pnlAtExpiry([leg], 103)).toBe(0);
    expect(pnlAtExpiry([leg], 110)).toBe(7);
    expect(breakevens([leg])).toEqual([103]);
    expect(extremes([leg])).toEqual({ maxProfit: Infinity, maxLoss: -3 });
  });

  it("short call: mirror image, unlimited loss", () => {
    const leg = singleLeg("short-call", 100, 3, 0.2, T);
    expect(pnlAtExpiry([leg], 90)).toBe(3);
    expect(breakevens([leg])).toEqual([103]);
    expect(extremes([leg])).toEqual({ maxProfit: 3, maxLoss: -Infinity });
  });

  it("long put: max profit when the stock goes to zero", () => {
    const leg = singleLeg("long-put", 100, 4, 0.2, T);
    expect(breakevens([leg])).toEqual([96]);
    expect(extremes([leg])).toEqual({ maxProfit: 96, maxLoss: -4 });
  });

  it("short put: keeps the premium above the strike, owns the loss below the breakeven", () => {
    const leg = singleLeg("short-put", 100, 4, 0.2, T, 2);
    expect(pnlAtExpiry([leg], 120)).toBe(8);
    expect(pnlAtExpiry([leg], 90)).toBe(-12);
    expect(breakevens([leg])).toEqual([96]);
    expect(extremes([leg])).toEqual({ maxProfit: 8, maxLoss: -192 });
  });
});

describe("multi-leg breakevens", () => {
  it("finds both breakevens of a long straddle", () => {
    const legs: Leg[] = [singleLeg("long-call", 100, 3, 0.2, T), singleLeg("long-put", 100, 2, 0.2, T)];
    expect(breakevens(legs)).toEqual([95, 105]);
  });

  it("bull call spread has bounded profit and loss", () => {
    const legs: Leg[] = [singleLeg("long-call", 100, 3, 0.2, T), singleLeg("short-call", 105, 1, 0.2, T)];
    expect(breakevens(legs)).toEqual([102]);
    expect(extremes(legs)).toEqual({ maxProfit: 3, maxLoss: -2 });
  });
});

describe("pricing before expiration", () => {
  it("is zero P/L today when the premium equals the model price", () => {
    const p = price({ type: "call", spot: 100, strike: 100, t: T, vol: 0.2, rate: RATE });
    const leg = singleLeg("long-call", 100, p, 0.2, T);
    expect(pnlAt([leg], 100, { daysForward: 0, ivShift: 0, rate: RATE })).toBeCloseTo(0, 10);
  });

  it("converges to the expiry payoff on expiration day", () => {
    const leg = singleLeg("short-put", 100, 2.5, 0.25, T);
    for (const s of [80, 97.5, 100, 120]) {
      expect(pnlAt([leg], s, { daysForward: 30, ivShift: 0, rate: RATE })).toBeCloseTo(pnlAtExpiry([leg], s), 10);
    }
  });

  it("long options gain from an IV increase, short options lose", () => {
    const at = (strategy: "long-call" | "short-call") =>
      pnlAt([singleLeg(strategy, 100, 2.5, 0.2, T)], 100, { daysForward: 0, ivShift: 0.3, rate: RATE }) -
      pnlAt([singleLeg(strategy, 100, 2.5, 0.2, T)], 100, { daysForward: 0, ivShift: 0, rate: RATE });
    expect(at("long-call")).toBeGreaterThan(0);
    expect(at("short-call")).toBeLessThan(0);
  });
});

describe("probabilities", () => {
  it("P(above) matches N(d2) and is monotone", () => {
    const atm = probAbove(100, 100, 0.2, 1, 0);
    expect(atm).toBeCloseTo(0.4602, 4); // N(-0.1)
    expect(probAbove(100, 90, 0.2, 1, 0)).toBeGreaterThan(atm);
    expect(probAbove(100, 0, 0.2, 1, 0)).toBe(1);
  });

  it("probability of profit of a long and short of the same option sum to 1", () => {
    const long = probOfProfit([singleLeg("long-call", 105, 2, 0.25, T)], 100, 0.25, T, RATE);
    const short = probOfProfit([singleLeg("short-call", 105, 2, 0.25, T)], 100, 0.25, T, RATE);
    expect(long + short).toBeCloseTo(1, 10);
    expect(short).toBeGreaterThan(0.8);
  });

  it("straddle profits outside both breakevens", () => {
    const legs = [singleLeg("long-call", 100, 3, 0.2, T), singleLeg("long-put", 100, 2, 0.2, T)];
    const expected = 1 - (probAbove(100, 95, 0.2, T, RATE) - probAbove(100, 105, 0.2, T, RATE));
    expect(probOfProfit(legs, 100, 0.2, T, RATE)).toBeCloseTo(expected, 10);
  });

  it("sigma range is symmetric in log space", () => {
    const [lo, hi] = sigmaRange(100, 0.2, 1, 1);
    expect(lo * hi).toBeCloseTo(100 * 100, 8);
    expect(hi).toBeCloseTo(100 * Math.exp(0.2), 8);
  });
});

describe("capital and the strike ladder", () => {
  it("uses premium, strike or share price as the capital basis", () => {
    expect(capitalBasis("long-put", 100, 3, 101).perShare).toBe(3);
    expect(capitalBasis("short-put", 95, 1.2, 101).perShare).toBe(95);
    expect(capitalBasis("short-call", 105, 1.2, 101).perShare).toBe(101);
  });

  const quotes = [90, 95, 100, 105, 110].map((k) => ({
    strike: k,
    premium: price({ type: "put", spot: 100, strike: k, t: T, vol: 0.25, rate: RATE }),
    iv: 0.25,
  }));

  it("short puts further OTM: more cushion, higher POP, lower yield", () => {
    const rows = strikeLadder("short-put", quotes, 100, T, RATE, 0.25);
    expect(rows.map((r) => r.strike)).toEqual([90, 95, 100, 105, 110]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.distance).toBeGreaterThan(rows[i - 1]!.distance);
      expect(rows[i]!.pop).toBeLessThan(rows[i - 1]!.pop);
      expect(rows[i]!.maxRet!).toBeGreaterThan(rows[i - 1]!.maxRet!);
    }
    const atm = rows[2]!;
    expect(atm.breakeven).toBeCloseTo(100 - atm.premium, 10);
    expect(atm.annualized).toBeCloseTo((atm.ret * 365) / 30, 8);
  });

  it("seller return if unchanged excludes intrinsic value, so it peaks at the money", () => {
    const rows = strikeLadder("short-put", quotes, 100, T, RATE, 0.25);
    const best = rows.reduce((a, b) => (b.ret > a.ret ? b : a));
    expect(best.strike).toBe(100);
    const itm = rows.find((r) => r.strike === 110)!;
    expect(itm.ret).toBeCloseTo((itm.premium - 10) / 110, 10);
    expect(itm.maxRet).toBeCloseTo(itm.premium / 110, 10);
  });

  it("long puts report the return at a 1σ drop", () => {
    const rows = strikeLadder("long-put", quotes, 100, T, RATE, 0.25);
    const target = sigmaRange(100, 0.25, T, 1)[0];
    const r = rows.find((x) => x.strike === 100)!;
    expect(r.ret).toBeCloseTo((100 - target - r.premium) / r.premium, 8);
    expect(r.annualized).toBeUndefined();
  });

  it("skips strikes without a usable premium", () => {
    expect(strikeLadder("long-call", [{ strike: 100, premium: 0, iv: 0.2 }], 100, T, RATE, 0.2)).toEqual([]);
  });
});
