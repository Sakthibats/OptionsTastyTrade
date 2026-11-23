/**
 * Demo mode: open the app with `?demo` to see it with simulated data. No
 * tastytrade calls and no credentials needed. Useful for UI work and screenshots.
 * Prices and greeks come from Black-Scholes with a skewed vol smile. Open interest
 * and volume are synthetic (clustered near the money and at round strikes).
 */
import { greeks, yearsToExpiry } from "./analytics/blackScholes";
import type { CustomerAccount, MarketDataSnapshot, MarketMetric, NestedExpiration, NestedOptionChain, Position } from "./api/types";
import type { MarketEvent, Subscription } from "./streaming/dxlink";

export const DEMO = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");

const RATE = 0.045;

interface Contract {
  underlying: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  monthly: boolean;
}
const contracts = new Map<string, Contract>();

/** Deterministic pseudo-random in [0, 1) from a string, so the demo is stable across reloads. */
function rand(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function baseSpot(symbol: string): number {
  if (symbol === "SPY") return 689.81;
  if (symbol === "QQQ") return 597.18;
  return Math.round(40 + rand(symbol) * 360) + 0.37;
}

/** Gentle random walk so prices tick in demo mode (one step per `tick`). */
function spotAt(symbol: string, tick: number): number {
  const base = baseSpot(symbol);
  const drift = 0.0012 * Math.sin(tick / 9) + 0.0004 * (rand(`${symbol}:${tick}`) - 0.5);
  return +(base * (1 + drift)).toFixed(2);
}

function nextFridays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7 || 7));
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

export function demoChain(symbol: string): NestedOptionChain[] {
  const spot = baseSpot(symbol);
  const step = spot > 300 ? 5 : spot > 100 ? 2.5 : 1;
  const center = Math.round(spot / step) * step;
  const today = Date.now();

  const expirations: NestedExpiration[] = nextFridays(10).map((date) => {
    const day = Number(date.slice(8, 10));
    const monthly = day >= 15 && day <= 21;
    const yymmdd = date.slice(2).replace(/-/g, "");
    const strikes = [];
    for (let i = -40; i <= 40; i++) {
      const k = +(center + i * step).toFixed(2);
      const callStreamer = `.${symbol}${yymmdd}C${k}`;
      const putStreamer = `.${symbol}${yymmdd}P${k}`;
      contracts.set(callStreamer, { underlying: symbol, type: "call", strike: k, expiration: date, monthly });
      contracts.set(putStreamer, { underlying: symbol, type: "put", strike: k, expiration: date, monthly });
      strikes.push({
        "strike-price": k.toFixed(2),
        call: `${symbol.padEnd(6)}${yymmdd}C${String(Math.round(k * 1000)).padStart(8, "0")}`,
        "call-streamer-symbol": callStreamer,
        put: `${symbol.padEnd(6)}${yymmdd}P${String(Math.round(k * 1000)).padStart(8, "0")}`,
        "put-streamer-symbol": putStreamer,
      });
    }
    return {
      "expiration-type": monthly ? "Regular" : "Weekly",
      "expiration-date": date,
      "days-to-expiration": Math.max(0, Math.ceil((Date.parse(`${date}T21:00:00Z`) - today) / 86_400_000)),
      "settlement-type": "PM",
      strikes,
    };
  });

  return [{ "underlying-symbol": symbol, "root-symbol": symbol, "option-chain-type": "Standard", "shares-per-contract": 100, expirations }];
}

export function demoMetrics(symbols: string[]): MarketMetric[] {
  return symbols.map((symbol) => ({
    symbol,
    "implied-volatility-index": String(0.12 + rand(`${symbol}iv`) * 0.25),
    "implied-volatility-index-rank": String(rand(`${symbol}rank`)),
    "implied-volatility-percentile": String(rand(`${symbol}pctl`)),
  }));
}

function smileVol(m: number, t: number): number {
  return Math.max(0.05, 0.125 + 0.02 / (1 + t * 12) + 0.9 * m * m - 0.28 * m);
}

/** Latest event per `${type}:${symbol}`, computed for the requested subscriptions at a given tick. */
export function demoEvents(subs: Subscription[], tick = 0): Map<string, MarketEvent> {
  const out = new Map<string, MarketEvent>();
  for (const { type, symbol } of subs) {
    const key = `${type}:${symbol}`;
    const c = contracts.get(symbol);

    if (!c) {
      const spot = spotAt(symbol, tick);
      const prev = prevClose(symbol);
      if (type === "Quote") out.set(key, ev(type, symbol, { bidPrice: spot - 0.01, askPrice: spot + 0.01 }));
      if (type === "Trade") out.set(key, ev(type, symbol, { price: spot }));
      if (type === "Summary")
        out.set(key, ev(type, symbol, { prevDayClosePrice: prev, dayHighPrice: +(Math.max(prev, spot) * 1.004).toFixed(2), dayLowPrice: +(Math.min(prev, spot) * 0.995).toFixed(2) }));
      continue;
    }

    const spot = spotAt(c.underlying, tick);
    const t = yearsToExpiry(c.expiration);
    const m = Math.log(c.strike / spot);
    const vol = smileVol(m, t);
    const g = greeks({ type: c.type, spot, strike: c.strike, t, vol, rate: RATE });
    const sm = Math.log(c.strike / baseSpot(c.underlying)); // size stats don't move with ticks

    switch (type) {
      case "Quote": {
        const half = Math.max(0.01, g.price * 0.02);
        out.set(key, ev(type, symbol, { bidPrice: +Math.max(0, g.price - half).toFixed(2), askPrice: +(g.price + half).toFixed(2) }));
        break;
      }
      case "Greeks":
        out.set(key, ev(type, symbol, { price: g.price, volatility: vol, delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega, rho: g.rho }));
        break;
      case "Summary":
        out.set(key, ev(type, symbol, { openInterest: openInterest(c, sm, t, symbol) }));
        break;
      case "Trade": {
        const oi = openInterest(c, sm, t, symbol);
        const dayVol = oi * (0.08 + 0.6 * Math.exp((-t * 365) / 6)) * (0.5 + rand(`${symbol}v`));
        out.set(key, ev(type, symbol, { dayVolume: Math.round(dayVol), price: g.price }));
        break;
      }
    }
  }
  return out;
}

function prevClose(symbol: string): number {
  return +(baseSpot(symbol) / (1 + (rand(symbol) - 0.4) * 0.02)).toFixed(2);
}

export function demoSnapshot(symbol: string): MarketDataSnapshot {
  return { symbol, mark: baseSpot(symbol), "prev-close": prevClose(symbol) };
}

function openInterest(c: Contract, m: number, t: number, symbol: string): number {
  const sideBias = c.type === "put" ? (m < 0 ? 1.5 : 0.6) : m > 0 ? 1.15 : 0.55;
  const width = 0.035 + 0.12 * Math.sqrt(t);
  let oi = 14000 * Math.exp(-((m / width) ** 2)) * sideBias;
  if (c.strike % 50 === 0) oi *= 2.6;
  else if (c.strike % 25 === 0) oi *= 1.7;
  else if (c.strike % 10 === 0) oi *= 1.25;
  if (c.monthly) oi *= 2.2;
  oi *= 0.55 + 0.9 * rand(symbol);
  return Math.round(oi);
}

function ev(eventType: MarketEvent["eventType"], eventSymbol: string, fields: Record<string, number>): MarketEvent {
  return { eventType, eventSymbol, ...fields } as MarketEvent;
}

export const demoAccounts: CustomerAccount[] = [
  { account: { "account-number": "5WT00001", nickname: "Demo margin", "account-type-name": "Individual" }, "authority-level": "owner" },
];

export function demoPositions(): Position[] {
  const exp = nextFridays(5)[3]!;
  const yymmdd = exp.slice(2).replace(/-/g, "");
  const opt = (type: "C" | "P", k: number) => `SPY   ${yymmdd}${type}${String(k * 1000).padStart(8, "0")}`;
  return [
    { "account-number": "5WT00001", symbol: "SPY", "instrument-type": "Equity", "underlying-symbol": "SPY", quantity: 100, "quantity-direction": "Long", "average-open-price": 571.2, "close-price": 689.81, multiplier: 1 },
    { "account-number": "5WT00001", symbol: opt("C", 710), "instrument-type": "Equity Option", "underlying-symbol": "SPY", quantity: 1, "quantity-direction": "Short", "average-open-price": 4.1, "close-price": 3.25, multiplier: 100, "expires-at": exp },
    { "account-number": "5WT00001", symbol: opt("P", 660), "instrument-type": "Equity Option", "underlying-symbol": "SPY", quantity: 2, "quantity-direction": "Short", "average-open-price": 3.6, "close-price": 2.4, multiplier: 100, "expires-at": exp },
    { "account-number": "5WT00001", symbol: opt("P", 650), "instrument-type": "Equity Option", "underlying-symbol": "SPY", quantity: 2, "quantity-direction": "Long", "average-open-price": 2.55, "close-price": 1.7, multiplier: 100, "expires-at": exp },
  ];
}
