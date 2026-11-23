import { describe, expect, it } from "vitest";
import { isValidYahooSymbol } from "./yahoo";

describe("Yahoo symbol validation", () => {
  it.each(["SPY", "BRK-B", "^GSPC", "ES=F", "BRK.B"])("accepts %s", (s) => expect(isValidYahooSymbol(s)).toBe(true));
  it.each(["", "spy", "../v7/x", "SPY/../../", "A".repeat(16), "SPY?x=1"])("rejects %s", (s) => expect(isValidYahooSymbol(s)).toBe(false));
});
