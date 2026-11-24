import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuoteToken } from "../api/queries";
import { DEMO, demoEvents } from "../demo";
import { DxLinkClient, type MarketEvent, type Subscription } from "./dxlink";

export type StreamStatus = "idle" | "connecting" | "authorized" | "closed" | "error" | "token error" | "demo";

/** After the socket drops, wait this long before reconnecting on our own. */
const RECONNECT_DELAY_MS = 3000;

export interface MarketData {
  status: StreamStatus;
  /** Latest event per `${eventType}:${symbol}`. */
  latest: Map<string, MarketEvent>;
  /** When the last batch of stream events arrived. */
  lastUpdate: number | null;
  /** Drop the socket and connect again (fresh snapshot of every subscription). */
  reconnect: () => void;
}

/** Merge a batch into the previous map. Pure, so React may call it whenever (and twice in StrictMode). */
export function mergeEvents(prev: Map<string, MarketEvent>, batch: ReadonlyMap<string, MarketEvent>): Map<string, MarketEvent> {
  const next = new Map(prev);
  for (const [k, v] of batch) next.set(k, v);
  return next;
}

/**
 * Subscribe to live DXLink events. Updates are batched to animation frames.
 * Reconnects automatically if the socket closes or errors.
 */
export function useMarketData(subs: Subscription[]): MarketData {
  const { data: token, error: tokenError } = useQuoteToken();
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [latest, setLatest] = useState<Map<string, MarketEvent>>(() => new Map());
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);
  const clientRef = useRef<DxLinkClient | null>(null);
  const subsRef = useRef(subs);
  subsRef.current = subs;

  const reconnect = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    if (!token) return;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const client = new DxLinkClient(token["dxlink-url"], token.token, (s) => {
      if (disposed) return;
      setStatus(s);
      if (s === "closed" || s === "error") {
        clearTimeout(retry);
        retry = setTimeout(() => setGeneration((g) => g + 1), RECONNECT_DELAY_MS);
      }
    });
    clientRef.current = client;
    client.setSubscriptions(subsRef.current);

    let buffer = new Map<string, MarketEvent>();
    let frame = 0;
    const off = client.onEvents((events) => {
      for (const ev of events) buffer.set(`${ev.eventType}:${ev.eventSymbol}`, ev);
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        // Hand React its own batch: the updater may run later, after the next batch has started.
        const batch = buffer;
        buffer = new Map();
        setLatest((prev) => mergeEvents(prev, batch));
        setLastUpdate(Date.now());
      });
    });

    client.connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      off();
      cancelAnimationFrame(frame);
      client.close();
      clientRef.current = null;
    };
  }, [token, generation]);

  const subsKey = subs.map((s) => `${s.type}:${s.symbol}`).join("|");
  useEffect(() => {
    clientRef.current?.setSubscriptions(subs);
  }, [subsKey, token, generation]);

  // Demo mode: recompute simulated events on a timer so prices visibly tick.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!DEMO) return;
    const id = setInterval(() => setTick((t) => t + 1), 1500);
    return () => clearInterval(id);
  }, []);
  const demo = useMemo(() => (DEMO ? demoEvents(subs, tick) : null), [subsKey, tick]);
  if (demo) return { status: "demo", latest: demo, lastUpdate: Date.now(), reconnect };

  return { status: tokenError ? "token error" : status, latest, lastUpdate, reconnect };
}
