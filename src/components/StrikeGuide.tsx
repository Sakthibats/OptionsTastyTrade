import { APPETITE_LABEL, type Appetite, type Guide, type GuideLevel, type PlanItem } from "../analytics/guide";
import { formatStrike, pct, signedPct } from "../analytics/metrics";
import type { LadderRow } from "../analytics/payoff";

/**
 * Prescriptive layer. Everything here wears the guide color (magenta) and the
 * compass badge, so it never reads as measured market data (blue/neutral).
 */
export function GuideBadge({ children = "Guide" }: { children?: string }) {
  return (
    <span className="rx-badge">
      <svg viewBox="0 0 20 20" aria-hidden>
        <circle cx="10" cy="10" r="7.25" />
        <path d="m12.9 7.1-1.7 4.1-4.1 1.7 1.7-4.1z" />
      </svg>
      {children}
    </span>
  );
}

/** Legend that separates the two color codes wherever they share a chart. */
export function DataGuideLegend() {
  return (
    <span className="dg-legend">
      <span>
        <i className="sw data" /> Market data
      </span>
      <span>
        <i className="sw rx" /> Guide
      </span>
    </span>
  );
}

export function StrikeGuideCard({
  guide,
  active,
  onPick,
  selected,
  rows,
  seller,
  type,
  spot,
  vol,
  dte,
  plan,
}: {
  guide: Guide;
  active: Appetite;
  onPick: (appetite: Appetite, strike: number) => void;
  selected?: number;
  rows: LadderRow[];
  seller: boolean;
  type: "call" | "put";
  spot: number;
  vol: number;
  dte: number;
  plan: PlanItem[];
}) {
  const em = guide.expectedMove;
  const sign = type === "put" ? "−" : "+";
  const out = (k: number) => (type === "put" ? spot - k * em : spot + k * em);
  const otm = (k: number) => (seller ? out(k) : type === "put" ? spot + k * em : spot - k * em);

  return (
    <section className="card rx-card">
      <div className="card-head">
        <div className="card-title">
          <GuideBadge />
          Where to set the strike
          <span className="muted">General rules of thumb by risk appetite, not advice</span>
        </div>
      </div>

      <div className="rx-levels" role="radiogroup" aria-label="Risk appetite">
        {guide.levels.map((l) => (
          <LevelCard key={l.appetite} level={l} on={l.appetite === active} picked={l.strike === selected} row={rows.find((r) => r.strike === l.strike)} seller={seller} onPick={onPick} />
        ))}
      </div>

      <div className="rx-body">
        <div className="rx-formulas">
          <div className="rx-section-title">Quick formulas</div>
          <Formula
            name="Expected move (1σ) by expiration"
            expr={
              <>
                EM = S × IV × √(DTE / 365)
              </>
            }
            result={`${spot.toFixed(2)} × ${pct(vol, 1)} × √(${dte}/365) = ±${em.toFixed(2)}`}
          />
          <Formula
            name="Strike for a target delta"
            expr={
              <>
                K = S · e<sup>−d₁·σ√t + (r + σ²/2)·t</sup>, d₁ = N⁻¹({type === "call" ? "Δ" : "1 − |Δ|"})
              </>
            }
            result="Exact under Black-Scholes with one IV; the cards use the chain's own deltas, so they include skew."
          />
          <Formula
            name="Shortcuts"
            expr={
              seller ? (
                <>
                  16Δ ≈ S {sign} EM · 30Δ ≈ S {sign} ½EM · 50Δ ≈ S
                </>
              ) : (
                <>
                  70Δ ≈ S {sign === "+" ? "−" : "+"} ½EM · 50Δ ≈ S · 30Δ ≈ S {sign} ½EM
                </>
              )
            }
            result={
              seller
                ? `${out(1).toFixed(2)} · ${out(0.5).toFixed(2)} · ${spot.toFixed(2)}`
                : `${otm(0.5).toFixed(2)} · ${spot.toFixed(2)} · ${out(0.5).toFixed(2)}`
            }
          />
        </div>

        <div className="rx-checks">
          <div className="rx-section-title">Does the setup fit?</div>
          {guide.checks.map((c) => (
            <div key={c.title} className={`rx-check ${c.ok === true ? "ok" : c.ok === false ? "no" : "info"}`}>
              <span className="rx-check-icon" aria-label={c.ok === true ? "fits" : c.ok === false ? "against" : "check"}>
                {c.ok === true ? "✓" : c.ok === false ? "!" : "?"}
              </span>
              <span>
                <b>{c.title}.</b> {c.text}
              </span>
            </div>
          ))}
        </div>

        <div className="rx-plan">
          <div className="rx-section-title">Exit plan for the selected strike</div>
          {plan.length ? (
            plan.map((p) => (
              <div key={p.label} className="rx-plan-row">
                <span className="rx-plan-label">{p.label}</span>
                <span className="rx-plan-rule">{p.rule}</span>
                <span className="rx-plan-value">{p.value}</span>
              </div>
            ))
          ) : (
            <div className="muted">Waiting for a quote.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function LevelCard({
  level: l,
  on,
  picked,
  row,
  seller,
  onPick,
}: {
  level: GuideLevel;
  on: boolean;
  picked: boolean;
  row?: LadderRow;
  seller: boolean;
  onPick: (appetite: Appetite, strike: number) => void;
}) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`rx-level ${on ? "on" : ""}`} onClick={() => onPick(l.appetite, l.strike)}>
      <span className="rx-level-top">
        <span className="rx-level-name">{APPETITE_LABEL[l.appetite]}</span>
        <span className="rx-chip on">{Math.round(l.delta * 100)}Δ</span>
      </span>
      <span className="rx-level-strike">
        {formatStrike(l.strike)}
        <span className="rx-level-sigma">
          {Math.abs(l.sigmas) < 0.05 ? "at the money" : `${Math.abs(l.sigmas).toFixed(1)}σ ${l.sigmas < 0 ? "below" : "above"} spot`}
        </span>
      </span>
      <span className="rx-level-why">{l.why}</span>
      {row && (
        <span className="rx-level-stats">
          <span>
            <b>{pct(row.pop, 0)}</b> chance of profit
          </span>
          <span>
            BE <b>{signedPct(row.distance)}</b>
          </span>
          <span>{seller ? <><b>{pct(row.annualized ?? row.ret, 1)}</b> a year</> : <><b>{signedPct(row.ret, 0)}</b> at 1σ</>}</span>
        </span>
      )}
      <span className="rx-level-foot">
        formula {l.formulaStrike.toFixed(2)}
        {l.chainDelta != null ? ` · chain Δ ${l.chainDelta.toFixed(2)}` : ""}
        <span className="rx-level-cta">{picked ? "Selected ✓" : `Use ${formatStrike(l.strike)} →`}</span>
      </span>
    </button>
  );
}

function Formula({ name, expr, result }: { name: string; expr: React.ReactNode; result: string }) {
  return (
    <div className="rx-formula">
      <div className="rx-formula-name">{name}</div>
      <div className="rx-formula-expr">{expr}</div>
      <div className="rx-formula-result">{result}</div>
    </div>
  );
}
