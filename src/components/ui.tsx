import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { SessionInfo } from "../analytics/market";
import { HEAT_STEPS, type HeatScale } from "../analytics/metrics";

/* ------------------------------------------------------------- Segmented */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- Field */

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

/* ------------------------------------------------------------- Stat */

export function Stat({
  label,
  value,
  sub,
  tone,
  children,
}: {
  label: string;
  value?: string;
  sub?: string;
  tone?: "up" | "down";
  children?: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? "–"}</div>
      {sub && <div className={`stat-sub ${tone ?? ""}`}>{sub}</div>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------- Status pill */

const STATUS_TEXT: Record<string, string> = {
  authorized: "Live",
  demo: "Demo data",
  connecting: "Connecting",
  idle: "Waiting",
  closed: "Disconnected",
  error: "Stream error",
  "token error": "No stream token",
};

export function StatusPill({ status }: { status: string }) {
  const tone = status === "authorized" ? "good" : status === "demo" ? "info" : status === "connecting" || status === "idle" ? "pending" : "bad";
  return (
    <span className={`status-pill ${tone}`}>
      <span className="dot" aria-hidden />
      {STATUS_TEXT[status] ?? status}
    </span>
  );
}

/* ------------------------------------------------------------- Heat legend */

export function HeatLegend({ title, scale, format }: { title: string; scale: HeatScale; format: (v: number) => string }) {
  if (!scale.edges.length) return null;
  const first = scale.edges[0]!;
  const last = scale.edges[scale.edges.length - 1]!;
  return (
    <div className="heat-legend" aria-label={`${title} color scale`}>
      <span className="heat-legend-title">{title}</span>
      <span className="heat-legend-tick">{format(first)}</span>
      <span className="heat-legend-ramp">
        {HEAT_STEPS.map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </span>
      <span className="heat-legend-tick">{format(last)}</span>
    </div>
  );
}

/* ------------------------------------------------------------- Tooltip */

export interface TipContent {
  value: string;
  label: string;
  rows?: Array<[string, string]>;
}

/** One floating tooltip per view. Cells call `show` on pointer enter, `hide` on leave. */
export function useTooltip() {
  const [tip, setTip] = useState<(TipContent & { x: number; y: number }) | null>(null);
  const show = useCallback((e: PointerEvent, content: TipContent) => setTip({ ...content, x: e.clientX, y: e.clientY }), []);
  const hide = useCallback(() => setTip(null), []);
  const node = tip && (
    <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }} role="tooltip">
      <div className="tooltip-value">{tip.value}</div>
      <div className="tooltip-label">{tip.label}</div>
      {tip.rows?.map(([k, v]) => (
        <div className="tooltip-row" key={k}>
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
  return { show, hide, node };
}

/* ------------------------------------------------------------- Flash on change */

/**
 * Renders a number that briefly flashes green when it rises and red when it falls.
 * The flash is a CSS animation restarted by changing the element key.
 */
export function Flash({ value, children, className = "" }: { value: number | undefined; children: ReactNode; className?: string }) {
  const prev = useRef<number | undefined>(value);
  const [state, setState] = useState<{ dir: "" | "up" | "down"; n: number }>({ dir: "", n: 0 });
  useEffect(() => {
    if (value != null && prev.current != null && value !== prev.current) {
      setState((s) => ({ dir: value > prev.current! ? "up" : "down", n: s.n + 1 }));
    }
    prev.current = value;
  }, [value]);
  return (
    <span key={state.n} className={`${className} ${state.dir ? `flash-${state.dir}` : ""}`}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- Market session */

const SESSION_TEXT = { pre: "Pre-market", regular: "Market open", post: "After hours", closed: "Market closed" } as const;

export function SessionPill({ info }: { info: SessionInfo }) {
  const left = info.minutesLeft != null ? ` · ${Math.floor(info.minutesLeft / 60)}h ${info.minutesLeft % 60}m left` : "";
  return (
    <span className={`session-pill ${info.session}`} title="US equity hours in New York time. Holidays are not detected.">
      <span className="dot" aria-hidden />
      {SESSION_TEXT[info.session]}
      <span className="session-left">{left}</span>
    </span>
  );
}

/* ------------------------------------------------------------- Meter (0..1) */

export function Meter({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <span style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------- Day range */

export function RangeBar({ low, high, value }: { low?: number; high?: number; value?: number }) {
  if (low == null || high == null || value == null || high <= low) return null;
  const at = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return (
    <div className="range">
      <span className="range-end">{low.toFixed(2)}</span>
      <span className="range-track" aria-label={`Day range ${low.toFixed(2)} to ${high.toFixed(2)}`}>
        <span className="range-fill" style={{ width: `${at * 100}%` }} />
        <span className="range-dot" style={{ left: `${at * 100}%` }} />
      </span>
      <span className="range-end">{high.toFixed(2)}</span>
    </div>
  );
}
