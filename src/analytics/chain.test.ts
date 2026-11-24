import { describe, expect, it } from "vitest";
import { ladderRows, type ChainRow } from "./chain";

const rows: ChainRow[] = Array.from({ length: 201 }, (_, i) => {
  const k = 500 + i; // $1 strikes from 500 to 700
  return { strike: k, callSymbol: `C${k}`, putSymbol: `P${k}`, callStreamer: `.C${k}`, putStreamer: `.P${k}` };
});

describe("ladderRows", () => {
  it("covers the ±2.5σ range around spot, thinned to the cap", () => {
    const out = ladderRows(rows, 600, 0.2, 30 / 365, { max: 41 });
    expect(out.length).toBeLessThanOrEqual(41);
    const w = 2.5 * 0.2 * Math.sqrt(30 / 365);
    expect(out[0]!.strike).toBeGreaterThanOrEqual(Math.floor(600 * Math.exp(-w)));
    expect(out.at(-1)!.strike).toBeLessThanOrEqual(Math.ceil(600 * Math.exp(w)));
    expect(out.at(-1)!.strike - out[0]!.strike).toBeGreaterThan(100);
  });

  it("keeps a minimum number of strikes near spot for very short expiries", () => {
    const out = ladderRows(rows, 600, 0.1, 0, { minEachSide: 8 });
    expect(out.map((r) => r.strike)).toEqual(Array.from({ length: 17 }, (_, i) => 592 + i));
  });

  it("never thins away the selected strike", () => {
    const out = ladderRows(rows, 600, 0.3, 90 / 365, { max: 21, keep: 603 });
    expect(out.some((r) => r.strike === 603)).toBe(true);
  });

  it("adds the selected strike even when it is outside the range", () => {
    const out = ladderRows(rows, 600, 0.1, 7 / 365, { keep: 520 });
    expect(out[0]!.strike).toBe(520);
  });
});
