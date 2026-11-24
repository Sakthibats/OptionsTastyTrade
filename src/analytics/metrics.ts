import type { EventType, MarketEvent } from "../streaming/dxlink";

/** Metrics the chain and heatmap can color by, and where each comes from in DXLink. */
export type MetricKey = "openInterest" | "volume" | "iv" | "delta";

export interface MetricDef {
  label: string;
  short: string;
  event: EventType;
  field: string;
  abs?: boolean;
  /** Counts are heavily skewed, so sqrt keeps mid-sized values visible. */
  scale: "sqrt" | "linear";
  format: (v: number) => string;
}

export const METRICS: Record<MetricKey, MetricDef> = {
  openInterest: { label: "Open interest", short: "OI", event: "Summary", field: "openInterest", scale: "sqrt", format: compact },
  volume: { label: "Volume", short: "Vol", event: "Trade", field: "dayVolume", scale: "sqrt", format: compact },
  iv: { label: "Implied vol", short: "IV", event: "Greeks", field: "volatility", scale: "linear", format: pct },
  delta: { label: "Delta", short: "Δ", event: "Greeks", field: "delta", abs: true, scale: "linear", format: (v) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2) },
};

export function metricValue(metric: MetricKey, latest: Map<string, MarketEvent>, streamerSymbol: string | undefined): number | null {
  if (!streamerSymbol) return null;
  const def = METRICS[metric];
  const v = num(latest.get(`${def.event}:${streamerSymbol}`)?.[def.field]);
  return v == null ? null : def.abs ? Math.abs(v) : v;
}

// ---------------------------------------------------------------- heat scale

/**
 * Sequential one-hue ramp (blue, light → dark), six classes. The lightest steps
 * mean "low" and recede toward the white surface. `HEAT_INK` is the text color per
 * step, picked by APCA contrast: dark ink on 1–3, white on 4–6.
 */
export const HEAT_STEPS = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"] as const;
export const HEAT_INK = ["#0b0b0b", "#0b0b0b", "#0b0b0b", "#ffffff", "#ffffff", "#ffffff"] as const;

export interface HeatScale {
  /** Bin index 0..5, or -1 for no value / zero (rendered as plain surface). */
  bin: (v: number | null | undefined) => number;
  /** Class boundaries in data units, length 7, for the legend. */
  edges: number[];
}

export function heatScale(values: Array<number | null | undefined>, kind: "sqrt" | "linear"): HeatScale {
  const vals = values.filter((v): v is number => v != null && Number.isFinite(v));
  const n = HEAT_STEPS.length;
  if (vals.length === 0) return { bin: () => -1, edges: [] };

  if (kind === "sqrt") {
    const max = Math.max(...vals);
    if (max <= 0) return { bin: () => -1, edges: [] };
    const rmax = Math.sqrt(max);
    return {
      bin: (v) => (v == null || !(v > 0) ? -1 : Math.min(n - 1, Math.floor((Math.sqrt(v) / rmax) * n))),
      edges: Array.from({ length: n + 1 }, (_, i) => (i / n) ** 2 * max),
    };
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  return {
    bin: (v) => (v == null || !Number.isFinite(v) ? -1 : Math.min(n - 1, Math.max(0, Math.floor(((v - min) / span) * n)))),
    edges: Array.from({ length: n + 1 }, (_, i) => min + (i / n) * span),
  };
}

export function heatStyle(bin: number): { background: string; color: string } | undefined {
  return bin < 0 ? undefined : { background: HEAT_STEPS[bin]!, color: HEAT_INK[bin]! };
}

// ---------------------------------------------------------------- formatting

export function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(0);
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

/** "SPY   261218C00620000" → "SPY Dec 18 '26 620 C". Non-OCC symbols pass through. */
export function formatOcc(symbol: string): string {
  const m = /^(\S+)\s+(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol);
  if (!m) return symbol;
  const [, root, yy, mm, dd, cp, k] = m;
  const month = new Date(Date.UTC(2000, Number(mm) - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${root} ${month} ${Number(dd)} '${yy} ${Number(k) / 1000} ${cp}`;
}

export function price(v: number | null | undefined): string {
  return v == null ? "–" : v.toFixed(2);
}

export function mid(q?: MarketEvent): number | undefined {
  const b = num(q?.bidPrice);
  const a = num(q?.askPrice);
  return b != null && a != null && a > 0 ? (a + b) / 2 : undefined;
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatStrike(k: number): string {
  return Number.isInteger(k) ? String(k) : k.toFixed(2).replace(/0$/, "");
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const USD2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$1,234" (or "$12.50" under $100), "Unlimited" for ±Infinity. `signed` adds +/−. */
export function usd(v: number, signed = false): string {
  if (!Number.isFinite(v)) return "Unlimited";
  const s = Math.abs(v) < 100 ? USD2.format(Math.abs(v)) : USD.format(Math.abs(v));
  if (v < 0) return `−${s}`;
  return signed && v > 0 ? `+${s}` : s;
}

export function signedPct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "∞";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(digits)}%`;
}
