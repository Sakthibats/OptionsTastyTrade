import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useSnapshot, useYahooQuote } from "./api/queries";
import { resolveSpot, usEquitySession, type SessionInfo, type Spot } from "./analytics/market";
import type { MarketEvent } from "./streaming/dxlink";

/** Wait this long for a streamed/snapshot price before asking Yahoo. */
const YAHOO_FALLBACK_DELAY_MS = 4000;

/** Re-evaluates the US equity session every 30 seconds. */
export function useSession(): SessionInfo {
  const [info, setInfo] = useState(() => usEquitySession());
  useEffect(() => {
    const id = setInterval(() => setInfo(usEquitySession()), 30_000);
    return () => clearInterval(id);
  }, []);
  return info;
}

/** True once `condition` has held for `ms` without interruption. Resets when `resetKey` changes. */
export function useStuck(condition: boolean, ms: number, resetKey: string): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    setStuck(false);
    if (!condition) return;
    const id = setTimeout(() => setStuck(true), ms);
    return () => clearTimeout(id);
  }, [condition, ms, resetKey]);
  return stuck;
}

/** Underlying price: live quote → last trade → tastytrade REST snapshot → Yahoo Finance. */
export function useUnderlying(symbol: string, latest: Map<string, MarketEvent>): { spot: Spot; yahooLoading: boolean; yahooError: boolean } {
  const snapshot = useSnapshot(symbol);
  const q = latest.get(`Quote:${symbol}`);
  const tr = latest.get(`Trade:${symbol}`);
  const su = latest.get(`Summary:${symbol}`);
  const withoutYahoo = resolveSpot(q, tr, su, snapshot.data, undefined);
  const needYahoo = useStuck(withoutYahoo.price == null, YAHOO_FALLBACK_DELAY_MS, symbol);
  const yahoo = useYahooQuote(symbol, needYahoo);
  return {
    spot: yahoo.data ? resolveSpot(q, tr, su, snapshot.data, yahoo.data) : withoutYahoo,
    yahooLoading: yahoo.isFetching,
    yahooError: yahoo.isError,
  };
}

/** Content width of an element, kept current with a ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * "Get the latest": refetch every REST query (chain, IV metrics, snapshot, Yahoo,
 * stream token) and reconnect the stream so DXLink resends a fresh snapshot.
 */
export function useRefresh(reconnect: () => void): { refresh: () => void; busy: boolean } {
  const qc = useQueryClient();
  const busy = useIsFetching() > 0;
  const refresh = useCallback(() => {
    void qc.invalidateQueries();
    reconnect();
  }, [qc, reconnect]);
  return { refresh, busy };
}

/** Current time, re-read every `ms` (for "updated 5s ago" labels). */
export function useNow(ms = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
