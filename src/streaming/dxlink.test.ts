import { describe, expect, it } from "vitest";
import { EVENT_FIELDS, parseCompact } from "./dxlink";

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
