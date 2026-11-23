import { describe, expect, it } from "vitest";
import { greeks, impliedVol, normCdf, price } from "./blackScholes";

const base = { spot: 100, strike: 100, t: 1, vol: 0.2, rate: 0.05 };

describe("Black-Scholes", () => {
  it("normCdf matches known values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1)).toBeCloseTo(0.158655, 5);
  });

  it("prices the textbook ATM call and put", () => {
    expect(price({ ...base, type: "call" })).toBeCloseTo(10.4506, 3);
    expect(price({ ...base, type: "put" })).toBeCloseTo(5.5735, 3);
  });

  it("satisfies put-call parity with dividends", () => {
    const inp = { ...base, strike: 110, divYield: 0.02 };
    const c = price({ ...inp, type: "call" });
    const p = price({ ...inp, type: "put" });
    const parity = inp.spot * Math.exp(-0.02 * inp.t) - inp.strike * Math.exp(-inp.rate * inp.t);
    expect(c - p).toBeCloseTo(parity, 6);
  });

  it("produces sane greeks", () => {
    const g = greeks({ ...base, type: "call" });
    expect(g.delta).toBeCloseTo(0.6368, 3);
    expect(g.gamma).toBeCloseTo(0.01876, 4);
    expect(g.vega).toBeCloseTo(0.3752, 3); // per 1 vol point
    expect(g.theta).toBeLessThan(0);
    const p = greeks({ ...base, type: "put" });
    expect(g.delta - p.delta).toBeCloseTo(1, 6);
  });

  it("recovers implied vol from price", () => {
    for (const vol of [0.08, 0.25, 0.9]) {
      for (const type of ["call", "put"] as const) {
        const target = price({ ...base, strike: 95, vol, type });
        expect(impliedVol(target, { ...base, strike: 95, type })).toBeCloseTo(vol, 4);
      }
    }
  });

  it("returns NaN for prices below intrinsic", () => {
    expect(impliedVol(0.01, { ...base, strike: 50, type: "call" })).toBeNaN();
  });
});
