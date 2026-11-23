import { useEffect, useMemo, useRef, useState } from "react";
import { useQuoteToken } from "../api/queries";
import { DEMO, demoEvents } from "../demo";
import { DxLinkClient, type MarketEvent, type Subscription } from "./dxlink";

export type StreamStatus = "idle" | "connecting" | "authorized" | "closed" | "error" | "token error" | "demo";

/**
 * Subscribe to live DXLink events. Returns the latest event per
 * `${eventType}:${symbol}` key. Updates are batched to animation frames.
 */
export function useMarketData(subs: Subscription[]): { status: StreamStatus; latest: Map<string, MarketEvent> } {
  const { data: token, error: tokenError } = useQuoteToken();
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [latest, setLatest] = useState<Map<string, MarketEvent>>(new Map());
  const clientRef = useRef<DxLinkClient | null>(null);

  useEffect(() => {
    if (!token) return;
    const client = new DxLinkClient(token["dxlink-url"], token.token, setStatus);
    clientRef.current = client;

    const buffer = new Map<string, MarketEvent>();
    let frame = 0;
    const off = client.onEvents((events) => {
      for (const ev of events) buffer.set(`${ev.eventType}:${ev.eventSymbol}`, ev);
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        setLatest((prev) => new Map([...prev, ...buffer]));
        buffer.clear();
      });
    });

    client.connect();
    return () => {
      off();
      cancelAnimationFrame(frame);
      client.close();
      clientRef.current = null;
    };
  }, [token]);

  const subsKey = subs.map((s) => `${s.type}:${s.symbol}`).join("|");
  useEffect(() => {
    clientRef.current?.setSubscriptions(subs);
  }, [subsKey, token]);

  // Demo mode: recompute simulated events on a timer so prices visibly tick.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!DEMO) return;
    const id = setInterval(() => setTick((t) => t + 1), 1500);
    return () => clearInterval(id);
  }, []);
  const demo = useMemo(() => (DEMO ? demoEvents(subs, tick) : null), [subsKey, tick]);
  if (demo) return { status: "demo", latest: demo };

  return { status: tokenError ? "token error" : status, latest };
}
