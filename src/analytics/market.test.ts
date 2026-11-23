import { describe, expect, it } from "vitest";
import type { MarketEvent } from "../streaming/dxlink";
import { resolveSpot, usEquitySession } from "./market";

const ev = (fields: Record<string, number>) => ({ eventType: "Quote", eventSymbol: "SPY", ...fields }) as MarketEvent;

describe("usEquitySession", () => {
  // Monday 2026-11-23; New York is UTC-5 in November.
  it.each([
    ["2026-11-23T06:30:00Z", "closed"], // 1:30 ET
    ["2026-11-23T10:00:00Z", "pre"], // 5:00 ET
    ["2026-11-23T15:00:00Z", "regular"], // 10:00 ET
    ["2026-11-23T21:30:00Z", "post"], // 16:30 ET
    ["2026-11-22T15:00:00Z", "closed"], // Sunday
  ])("%s → %s", (iso, session) => expect(usEquitySession(new Date(iso)).session).toBe(session));

  it("reports minutes left in the session", () => {
    expect(usEquitySession(new Date("2026-11-23T20:30:00Z")).minutesLeft).toBe(30); // 15:30 ET
  });
});

describe("resolveSpot", () => {
  it("prefers a tight live quote", () => {
    const s = resolveSpot(ev({ bidPrice: 600, askPrice: 600.02 }), ev({ price: 599 }), undefined, undefined, undefined);
    expect(s.source).toBe("live quote");
    expect(s.price).toBeCloseTo(600.01);
  });

  it("falls back to last trade when the quote is empty or wide (market closed)", () => {
    expect(resolveSpot(ev({ bidPrice: 0, askPrice: 0 }), ev({ price: 689.81 }), undefined, undefined, undefined).source).toBe("last trade");
    expect(resolveSpot(ev({ bidPrice: 680, askPrice: 700 }), ev({ price: 689.81 }), undefined, undefined, undefined).price).toBe(689.81);
  });

  it("falls back to the REST snapshot, then Yahoo", () => {
    expect(resolveSpot(undefined, undefined, undefined, { symbol: "SPY", mark: "689.8" }, undefined).source).toBe("tastytrade snapshot");
    const y = resolveSpot(undefined, undefined, undefined, undefined, {
      symbol: "SPY", price: 689.81, previousClose: 715.87, dayHigh: null, dayLow: null, currency: "USD", time: null,
    });
    expect(y).toMatchObject({ source: "Yahoo Finance", price: 689.81, prevClose: 715.87 });
  });

  it("returns no price when nothing is available", () => {
    expect(resolveSpot(undefined, undefined, undefined, undefined, undefined).price).toBeUndefined();
  });
});
