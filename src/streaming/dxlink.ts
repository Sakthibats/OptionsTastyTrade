/**
 * Minimal DXLink WebSocket client for tastytrade market data, run directly in the
 * browser (no server needed: the token from /api-quote-tokens is market-data
 * only and expires in 24h).
 *
 * Protocol: SETUP → AUTH → CHANNEL_REQUEST(FEED) → FEED_SETUP(COMPACT) →
 * FEED_SUBSCRIPTION, plus KEEPALIVE every 30s.
 * Docs: https://developer.tastytrade.com/docs/guides/stream-market-data/
 *
 * Verified against tastytrade's live feed (Nov 2026): the server echoes these
 * EVENT_FIELDS in FEED_CONFIG and FEED_DATA matches parseCompact's layout.
 */

export type EventType = "Quote" | "Trade" | "Greeks" | "Summary" | "Profile";

export const EVENT_FIELDS: Record<EventType, string[]> = {
  Quote: ["eventType", "eventSymbol", "bidPrice", "askPrice", "bidSize", "askSize"],
  Trade: ["eventType", "eventSymbol", "price", "dayVolume", "size"],
  Greeks: ["eventType", "eventSymbol", "price", "volatility", "delta", "gamma", "theta", "rho", "vega"],
  Summary: ["eventType", "eventSymbol", "openInterest", "dayOpenPrice", "dayHighPrice", "dayLowPrice", "prevDayClosePrice"],
  Profile: ["eventType", "eventSymbol", "description", "highLimitPrice", "lowLimitPrice"],
};

export type MarketEvent = { eventType: EventType; eventSymbol: string } & Record<string, number | string | null>;

export interface Subscription {
  type: EventType;
  symbol: string;
}

type Listener = (events: MarketEvent[]) => void;
type Status = "connecting" | "authorized" | "closed" | "error";

const FEED_CHANNEL = 1;

export class DxLinkClient {
  private ws: WebSocket | null = null;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private feedReady = false;
  private fields: Record<string, string[]> = { ...EVENT_FIELDS };
  private subs = new Map<string, Subscription>();
  private listeners = new Set<Listener>();

  constructor(
    private url: string,
    private token: string,
    private onStatus: (s: Status) => void = () => {},
  ) {}

  connect(): void {
    this.onStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.send({ type: "SETUP", channel: 0, version: "0.1-js/1.0.0", keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 });
      this.keepalive = setInterval(() => this.send({ type: "KEEPALIVE", channel: 0 }), 30_000);
    };
    ws.onmessage = (e) => this.handle(JSON.parse(String(e.data)));
    ws.onerror = () => this.onStatus("error");
    ws.onclose = () => {
      this.cleanup();
      this.onStatus("closed");
    };
  }

  close(): void {
    this.ws?.close();
    this.cleanup();
  }

  onEvents(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Replace the full subscription set (diffs against the current one). */
  setSubscriptions(next: Subscription[]): void {
    const key = (s: Subscription) => `${s.type}:${s.symbol}`;
    const nextMap = new Map(next.map((s) => [key(s), s]));
    const add = next.filter((s) => !this.subs.has(key(s)));
    const remove = [...this.subs.values()].filter((s) => !nextMap.has(key(s)));
    this.subs = nextMap;
    if (!this.feedReady) return; // sent on CHANNEL_OPENED
    if (add.length || remove.length) {
      this.send({ type: "FEED_SUBSCRIPTION", channel: FEED_CHANNEL, add, remove });
    }
  }

  private handle(msg: { type: string; channel?: number; state?: string; data?: unknown; eventFields?: Record<string, string[]> }): void {
    switch (msg.type) {
      case "AUTH_STATE":
        if (msg.state === "UNAUTHORIZED") {
          this.send({ type: "AUTH", channel: 0, token: this.token });
        } else if (msg.state === "AUTHORIZED") {
          this.onStatus("authorized");
          this.send({ type: "CHANNEL_REQUEST", channel: FEED_CHANNEL, service: "FEED", parameters: { contract: "AUTO" } });
        }
        break;
      case "CHANNEL_OPENED":
        if (msg.channel === FEED_CHANNEL) {
          this.send({
            type: "FEED_SETUP",
            channel: FEED_CHANNEL,
            acceptAggregationPeriod: 0.5,
            acceptDataFormat: "COMPACT",
            acceptEventFields: this.fields,
          });
          this.feedReady = true;
          this.send({ type: "FEED_SUBSCRIPTION", channel: FEED_CHANNEL, reset: true, add: [...this.subs.values()] });
        }
        break;
      case "FEED_CONFIG":
        if (msg.eventFields) this.fields = { ...this.fields, ...msg.eventFields };
        break;
      case "FEED_DATA": {
        const events = parseCompact(msg.data, this.fields);
        if (events.length) this.listeners.forEach((fn) => fn(events));
        break;
      }
      case "ERROR":
        console.warn("DXLink error", msg);
        break;
    }
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private cleanup(): void {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    this.feedReady = false;
  }
}

/**
 * COMPACT FEED_DATA: `data` is [type, values, type, values, ...] where `values`
 * is a flat array of field values for one or more events, in the order agreed in
 * FEED_SETUP/FEED_CONFIG. Numeric fields may arrive as "NaN"/"Infinity" strings.
 */
export function parseCompact(data: unknown, fields: Record<string, string[]>): MarketEvent[] {
  if (!Array.isArray(data)) return [];
  const out: MarketEvent[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    const type = data[i] as string;
    const values = data[i + 1] as unknown[];
    const names = fields[type];
    if (!names || !Array.isArray(values)) continue;
    for (let j = 0; j + names.length <= values.length; j += names.length) {
      const ev: Record<string, number | string | null> = {};
      names.forEach((name, k) => {
        const v = values[j + k];
        ev[name] = v === "NaN" || v === "Infinity" || v === "-Infinity" ? null : (v as number | string | null);
      });
      out.push(ev as MarketEvent);
    }
  }
  return out;
}
