import { useQuery } from "@tanstack/react-query";
import { DEMO, demoChain, demoMetrics, demoSnapshot } from "../demo";
import { getJson, ttGet } from "./client";
import type { Items, MarketDataSnapshot, MarketMetric, NestedOptionChain, QuoteToken, YahooQuote } from "./types";

export const useNestedChain = (symbol: string | undefined) =>
  useQuery({
    queryKey: ["chain", symbol],
    queryFn: () => (DEMO ? demoChain(symbol!) : ttGet<Items<NestedOptionChain>>(`/option-chains/${symbol}/nested`).then((d) => d.items)),
    enabled: !!symbol,
    staleTime: 15 * 60_000,
  });

export const useMarketMetrics = (symbols: string[]) =>
  useQuery({
    queryKey: ["market-metrics", symbols],
    queryFn: () => (DEMO ? demoMetrics(symbols) : ttGet<Items<MarketMetric>>("/market-metrics", { symbols }).then((d) => d.items)),
    enabled: symbols.length > 0,
    staleTime: 5 * 60_000,
  });

/** DXLink tokens last 24h; refetch well before that. Never fetched in demo mode. */
export const useQuoteToken = () =>
  useQuery({
    queryKey: ["quote-token"],
    queryFn: () => ttGet<QuoteToken>("/api-quote-tokens"),
    enabled: !DEMO,
    staleTime: 12 * 60 * 60_000,
  });

/** REST quote snapshot for the underlying. Works when the market is closed, unlike a fresh stream quote. */
export const useSnapshot = (symbol: string | undefined) =>
  useQuery({
    queryKey: ["snapshot", symbol],
    queryFn: () =>
      DEMO ? demoSnapshot(symbol!) : ttGet<Items<MarketDataSnapshot>>("/market-data/by-type", { equity: symbol }).then((d) => d.items[0]),
    enabled: !!symbol,
    refetchInterval: 60_000,
    retry: 0,
  });

/** Last-resort underlying price via the Worker's Yahoo Finance proxy. Pass enabled=false while better sources exist. */
export const useYahooQuote = (symbol: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ["yahoo", symbol],
    queryFn: () => getJson<YahooQuote>(`/api/yahoo/quote/${encodeURIComponent(symbol!)}`),
    enabled: !!symbol && enabled && !DEMO,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 0,
  });
