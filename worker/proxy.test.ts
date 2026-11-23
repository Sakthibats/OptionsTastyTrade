import { describe, expect, it } from "vitest";
import { isAllowed } from "./proxy";

describe("tastytrade proxy allowlist", () => {
  it.each([
    "/customers/me/accounts",
    "/accounts/5WX12345/positions",
    "/accounts/5WX12345/balances",
    "/option-chains/AAPL/nested",
    "/option-chains/BRK.B/compact",
    "/market-metrics",
    "/api-quote-tokens",
  ])("allows GET %s", (path) => {
    expect(isAllowed("GET", path)).toBe(true);
  });

  it.each([
    ["POST", "/accounts/5WX12345/orders"],
    ["GET", "/accounts/5WX12345/orders"],
    ["DELETE", "/accounts/5WX12345/orders/1"],
    ["POST", "/option-chains/AAPL/nested"],
    ["GET", "/accounts/5WX12345/positions/../orders"],
    ["GET", "/oauth/token"],
    ["GET", "/customers/me"],
  ])("blocks %s %s", (method, path) => {
    expect(isAllowed(method, path)).toBe(false);
  });
});
