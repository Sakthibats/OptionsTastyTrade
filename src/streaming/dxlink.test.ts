import { describe, expect, it } from "vitest";
import { EVENT_FIELDS, parseCompact, type MarketEvent } from "./dxlink";

describe("parseCompact", () => {
  it("splits a flat COMPACT payload into events", () => {
    const data = ["Quote", ["Quote", "SPY", 500.1, 500.2, 10, 12, "Quote", "AAPL", 190, 190.05, 3, "NaN"]];
    const events = parseCompact(data, EVENT_FIELDS);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ eventSymbol: "SPY", bidPrice: 500.1, askPrice: 500.2 });
    expect(events[1]).toMatchObject({ eventSymbol: "AAPL", askSize: null });
  });

  it("ignores unknown event types and malformed input", () => {
    expect(parseCompact(["Mystery", [1, 2, 3]], EVENT_FIELDS)).toEqual([]);
    expect(parseCompact("nope", EVENT_FIELDS)).toEqual([]);
  });
});

describe("mergeEvents", () => {
  it("keeps earlier symbols and overwrites updated ones without mutating either input", async () => {
    const { mergeEvents } = await import("./useMarketData");
    const q = (sym: string, bid: number) => ({ eventType: "Quote", eventSymbol: sym, bidPrice: bid }) as unknown as MarketEvent;
    const prev = new Map([["Quote:A", q("A", 1)]]);
    const batch = new Map([["Quote:A", q("A", 2)], ["Quote:B", q("B", 3)]]);
    const next = mergeEvents(prev, batch);
    expect(next.get("Quote:A")!.bidPrice).toBe(2);
    expect(next.get("Quote:B")!.bidPrice).toBe(3);
    expect(prev.size).toBe(1);
    expect(batch.size).toBe(2);
  });
});
