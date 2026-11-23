import { describe, expect, it } from "vitest";
import { compact, formatOcc, heatScale } from "./metrics";

describe("heatScale", () => {
  it("sqrt scale: zero and missing recede, max hits the top bin", () => {
    const s = heatScale([0, 100, 2500, 10000, null], "sqrt");
    expect(s.bin(0)).toBe(-1);
    expect(s.bin(null)).toBe(-1);
    expect(s.bin(10000)).toBe(5);
    expect(s.bin(2500)).toBe(3); // sqrt(0.25) = 0.5 → bin 3 of 0..5
    expect(s.edges).toHaveLength(7);
    expect(s.edges[6]).toBe(10000);
  });

  it("linear scale spans min..max", () => {
    const s = heatScale([0.1, 0.2, 0.4], "linear");
    expect(s.bin(0.1)).toBe(0);
    expect(s.bin(0.4)).toBe(5);
    expect(s.edges[0]).toBeCloseTo(0.1);
  });

  it("handles empty input", () => {
    expect(heatScale([], "linear").bin(1)).toBe(-1);
  });
});

describe("compact", () => {
  it.each([
    [950, "950"],
    [1520, "1.5k"],
    [48200, "48k"],
    [3_400_000, "3.4M"],
  ])("%d → %s", (v, out) => expect(compact(v)).toBe(out));
});

describe("formatOcc", () => {
  it("formats OCC option symbols", () => {
    expect(formatOcc("SPY   261218C00620000")).toBe("SPY Dec 18 '26 620 C");
    expect(formatOcc("BRK/B 270115P00412500")).toBe("BRK/B Jan 15 '27 412.5 P");
    expect(formatOcc("AAPL")).toBe("AAPL");
  });
});
