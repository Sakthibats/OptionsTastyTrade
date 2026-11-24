import { describe, expect, it } from "vitest";
import { greeks, normCdf, normInv, strikeForDelta } from "./blackScholes";
import { contextChecks, expectedMove, managementPlan, strikeGuide } from "./guide";

const RATE = 0.045;
const T = 30 / 365;

describe("normInv", () => {
  it("inverts the normal CDF", () => {
    expect(normInv(0.5)).toBeCloseTo(0, 9);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
    for (const x of [-3.2, -1, -0.1, 0.7, 2.5]) expect(normInv(normCdf(x))).toBeCloseTo(x, 5);
  });
});

describe("strikeForDelta", () => {
  it.each([
    ["call", 0.16],
    ["call", 0.5],
    ["put", 0.3],
    ["put", 0.7],
  ] as const)("%s at %s delta round-trips through Black-Scholes", (type, target) => {
    const k = strikeForDelta(type, target, 100, 0.25, T, RATE);
    const d = greeks({ type, spot: 100, strike: k, t: T, vol: 0.25, rate: RATE }).delta;
    expect(Math.abs(d)).toBeCloseTo(target, 6);
  });

  it("16-delta is roughly one expected move out of the money", () => {
    const em = expectedMove(100, 0.25, T);
    // Within ~1% of spot: the drift term (r + σ²/2)·t nudges it, which is why it's a rule of thumb.
    expect(Math.abs(strikeForDelta("put", 0.16, 100, 0.25, T, RATE) - (100 - em))).toBeLessThan(1);
    expect(Math.abs(strikeForDelta("call", 0.16, 100, 0.25, T, RATE) - (100 + em))).toBeLessThan(1);
  });
});

describe("strikeGuide", () => {
  const chain = Array.from({ length: 41 }, (_, i) => {
    const strike = 80 + i;
    return { strike, delta: greeks({ type: "put", spot: 100, strike, t: T, vol: 0.25, rate: RATE }).delta };
  });
  const input = { spot: 100, vol: 0.25, t: T, dte: 30, rate: RATE, ivRank: 0.5, chain };

  it("short put: conservative is furthest out of the money, picked by chain delta", () => {
    const g = strikeGuide("short-put", input)!;
    const [c, b, a] = g.levels;
    expect(c!.strike).toBeLessThan(b!.strike);
    expect(b!.strike).toBeLessThan(a!.strike);
    expect(Math.abs(b!.chainDelta!)).toBeCloseTo(0.3, 1);
    expect(g.zone).toEqual([c!.strike, a!.strike]);
    expect(Math.abs(b!.strike - b!.formulaStrike)).toBeLessThan(1);
  });

  it("long call: conservative is in the money, aggressive out of the money", () => {
    const callChain = chain.map((c) => ({ strike: c.strike, delta: greeks({ type: "call", spot: 100, strike: c.strike, t: T, vol: 0.25, rate: RATE }).delta }));
    const g = strikeGuide("long-call", { ...input, chain: callChain })!;
    expect(g.levels[0]!.strike).toBeLessThan(100);
    expect(g.levels[2]!.strike).toBeGreaterThan(100);
  });

  it("falls back to the formula strike when the chain has no deltas", () => {
    const g = strikeGuide("short-put", { ...input, chain: chain.map(({ strike }) => ({ strike })) })!;
    for (const l of g.levels) expect(Math.abs(l.strike - l.formulaStrike)).toBeLessThanOrEqual(0.5);
  });

  it("flags the volatility regime and days to expiration", () => {
    expect(contextChecks("short-put", 10, 0.1).filter((c) => c.ok === false)).toHaveLength(2);
    expect(contextChecks("long-call", 90, 0.1).filter((c) => c.ok === true)).toHaveLength(2);
  });
});

describe("managementPlan", () => {
  it("seller: half the credit as the target, twice the credit as the stop", () => {
    const [tp, stop, time] = managementPlan("short-put", 2, 1, 100, 40, "2026-12-31");
    expect(tp!.value).toBe("buy back at 1.00 · +$100");
    expect(stop!.value).toBe("buy back at 6.00 · −$400");
    expect(time!.value).toBe("Dec 10");
  });
});
