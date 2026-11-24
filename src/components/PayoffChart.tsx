import { useId, useMemo, useState, type PointerEvent } from "react";
import { formatStrike, signedPct, usd } from "../analytics/metrics";
import { MULTIPLIER, pnlAt, pnlAtExpiry, probAbove, sigmaRange, type Leg, type Scenario } from "../analytics/payoff";
import { useWidth } from "../hooks";
import { linear, niceTicks, padExtent, pathOf } from "./chart";
import { useTooltip } from "./ui";

export type PayoffMode = "usd" | "pct";

const HEIGHT = 360;
const M = { top: 30, right: 18, bottom: 34, left: 62 };
const SAMPLES = 220;

/**
 * P/L across underlying prices: the expiration payoff (solid) and the position
 * valued at a what-if date and IV (dashed). Green/red fill = profit/loss zones at
 * expiration. Shaded band = the market's ±1σ expected move by expiration.
 */
export function PayoffChart({
  legs,
  spot,
  vol,
  t,
  rate,
  scenario,
  scenarioLabel,
  mode,
  capital,
  breakevens,
  guide,
}: {
  legs: Leg[];
  spot: number;
  /** Vol for the expected-move band and probabilities (the leg's IV for one leg). */
  vol: number;
  t: number;
  rate: number;
  scenario: Scenario;
  scenarioLabel: string;
  mode: PayoffMode;
  /** Total capital in dollars, the denominator in "pct" mode. */
  capital: number;
  breakevens: number[];
  /** Guide strike for the chosen risk appetite (prescriptive marker, magenta). */
  guide?: { strike: number; label: string };
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTooltip();
  const clip = useId().replace(/:/g, "");
  const [hoverX, setHoverX] = useState<number | null>(null);
  const strikes = [...new Set(legs.map((l) => l.strike))];
  const showScenario = scenario.daysForward < t * 365 - 1e-9;

  const model = useMemo(() => {
    // Domain: ±3σ by expiration, but always wide enough to show strikes and breakevens.
    const [lo3, hi3] = sigmaRange(spot, vol, t, 3);
    const marks = [spot, ...strikes, ...breakevens, ...(guide ? [guide.strike] : [])];
    let x0 = Math.min(lo3, spot * 0.95, ...marks.map((m) => m * 0.97));
    let x1 = Math.max(hi3, spot * 1.05, ...marks.map((m) => m * 1.03));
    x0 = Math.max(0, x0);
    const xs = Array.from({ length: SAMPLES + 1 }, (_, i) => x0 + ((x1 - x0) * i) / SAMPLES);
    xs.push(...strikes.filter((k) => k > x0 && k < x1));
    xs.sort((a, b) => a - b);

    const scale = mode === "pct" && capital > 0 ? MULTIPLIER / capital : MULTIPLIER;
    const exp = xs.map((x) => pnlAtExpiry(legs, x) * scale);
    const now = showScenario ? xs.map((x) => pnlAt(legs, x, scenario) * scale) : [];
    const ys = [...exp, ...now, 0];
    const [y0, y1] = padExtent(Math.min(...ys), Math.max(...ys), 0.1);
    return { x0, x1, xs, exp, now, y0, y1, scale };
  }, [legs, spot, vol, t, scenario, mode, capital, breakevens.join(), showScenario, guide?.strike]);

  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = HEIGHT - M.top - M.bottom;
  const x = linear([model.x0, model.x1], [M.left, M.left + innerW]);
  const y = linear([model.y0, model.y1], [M.top + innerH, M.top]);
  const zeroY = y(0);
  const fmtY = (v: number) => (mode === "pct" ? signedPct(v, Math.abs(model.y1 - model.y0) < 0.2 ? 1 : 0) : usd(v, true));

  const expPts = model.xs.map((v, i) => [x(v), y(model.exp[i]!)] as [number, number]);
  const nowPts = model.now.map((v, i) => [x(model.xs[i]!), y(v)] as [number, number]);
  const area = `${pathOf(expPts)}L${x(model.x1).toFixed(1)},${zeroY.toFixed(1)}L${x(model.x0).toFixed(1)},${zeroY.toFixed(1)}Z`;
  const [s1lo, s1hi] = sigmaRange(spot, vol, t, 1);

  // Direct labels at the right edge, nudged apart if they would collide.
  const lastExpY = expPts.at(-1)?.[1] ?? zeroY;
  let lastNowY = nowPts.at(-1)?.[1] ?? zeroY;
  if (showScenario && Math.abs(lastNowY - lastExpY) < 14) lastNowY = lastExpY + (lastNowY >= lastExpY ? 14 : -14);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = Math.max(M.left, Math.min(M.left + innerW, e.clientX - rect.left));
    const s = x.invert(px);
    setHoverX(s);
    const atExp = pnlAtExpiry(legs, s) * model.scale;
    const rows: Array<[string, string]> = [["At expiration", fmtY(atExp)]];
    if (showScenario) rows.push([scenarioLabel, fmtY(pnlAt(legs, s, scenario) * model.scale)]);
    const pAbove = probAbove(spot, s, vol, t, rate);
    rows.push(["Move from spot", signedPct(s / spot - 1)]);
    rows.push([s >= spot ? "Chance it ends above" : "Chance it ends below", `${((s >= spot ? pAbove : 1 - pAbove) * 100).toFixed(0)}%`]);
    tip.show(e, { value: s.toFixed(2), label: "Underlying price", rows });
  };

  const hover =
    hoverX != null
      ? {
          px: x(hoverX),
          exp: y(pnlAtExpiry(legs, hoverX) * model.scale),
          now: showScenario ? y(pnlAt(legs, hoverX, scenario) * model.scale) : null,
        }
      : null;

  return (
    <div className="payoff-chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label="Profit and loss by underlying price"
          onPointerMove={onMove}
          onPointerLeave={() => {
            setHoverX(null);
            tip.hide();
          }}
        >
          <defs>
            <clipPath id={`${clip}-up`}>
              <rect x={M.left} y={M.top} width={innerW} height={Math.max(0, zeroY - M.top)} />
            </clipPath>
            <clipPath id={`${clip}-down`}>
              <rect x={M.left} y={zeroY} width={innerW} height={Math.max(0, M.top + innerH - zeroY)} />
            </clipPath>
            <clipPath id={`${clip}-plot`}>
              <rect x={M.left} y={M.top} width={innerW} height={innerH} />
            </clipPath>
          </defs>

          {/* 1σ expected-move band */}
          <rect className="pc-band" x={x(s1lo)} y={M.top} width={Math.max(0, x(s1hi) - x(s1lo))} height={innerH} clipPath={`url(#${clip}-plot)`} />

          {/* grid + axes */}
          {niceTicks(model.y0, model.y1, 6).map((v) => (
            <g key={`y${v}`}>
              <line className="pc-grid" x1={M.left} x2={M.left + innerW} y1={y(v)} y2={y(v)} />
              <text className="pc-axis" x={M.left - 8} y={y(v) + 4} textAnchor="end">
                {fmtY(v)}
              </text>
            </g>
          ))}
          {niceTicks(model.x0, model.x1, Math.max(3, Math.floor(innerW / 90))).map((v) => (
            <text key={`x${v}`} className="pc-axis" x={x(v)} y={HEIGHT - 12} textAnchor="middle">
              {formatStrike(v)}
            </text>
          ))}

          {/* profit / loss zones at expiration */}
          <path className="pc-profit" d={area} clipPath={`url(#${clip}-up)`} />
          <path className="pc-loss" d={area} clipPath={`url(#${clip}-down)`} />
          <line className="pc-zero" x1={M.left} x2={M.left + innerW} y1={zeroY} y2={zeroY} />

          {/* guide strike (prescriptive) */}
          {guide && !strikes.includes(guide.strike) && (
            <g>
              <line className="rx-line on" x1={x(guide.strike)} x2={x(guide.strike)} y1={M.top} y2={M.top + innerH} />
              <text className="rx-label on" x={x(guide.strike) + 5} y={M.top + innerH - 24}>
                Guide {formatStrike(guide.strike)} · {guide.label}
              </text>
            </g>
          )}

          {/* strike(s) */}
          {strikes.map((k) => {
            const isGuide = guide?.strike === k;
            return (
              <g key={`k${k}`}>
                <line className={isGuide ? "rx-line on" : "pc-strike"} x1={x(k)} x2={x(k)} y1={M.top} y2={M.top + innerH} />
                <text className={isGuide ? "rx-label on" : "pc-mark-label"} x={x(k) + 5} y={M.top + innerH - 6}>
                  Strike {formatStrike(k)}
                  {isGuide ? ` · guide ${guide!.label}` : ""}
                </text>
              </g>
            );
          })}

          {/* spot */}
          <line className="pc-spot" x1={x(spot)} x2={x(spot)} y1={M.top - 6} y2={M.top + innerH} />
          <g transform={`translate(${x(spot)},${M.top - 14})`}>
            <rect className="pc-spot-chip" x={-38} y={-10} width={76} height={19} rx={9.5} />
            <text className="pc-spot-text" y={4} textAnchor="middle">
              Spot {spot.toFixed(2)}
            </text>
          </g>

          {/* curves */}
          <g clipPath={`url(#${clip}-plot)`}>
            {showScenario && <path className="pc-now" d={pathOf(nowPts)} />}
            <path className="pc-exp" d={pathOf(expPts)} />
          </g>
          <text className="pc-direct exp" x={M.left + innerW - 4} y={lastExpY - 8} textAnchor="end">
            At expiration
          </text>
          {showScenario && (
            <text className="pc-direct now" x={M.left + innerW - 4} y={lastNowY + (lastNowY > lastExpY ? 16 : -8)} textAnchor="end">
              {scenarioLabel}
            </text>
          )}

          {/* breakevens */}
          {breakevens
            .filter((b) => b >= model.x0 && b <= model.x1)
            .map((b) => (
              <g key={`be${b}`} transform={`translate(${x(b)},${zeroY})`}>
                <circle className="pc-be" r={5} />
                <text className="pc-be-label" y={-10} textAnchor="middle">
                  BE {b.toFixed(2)}
                </text>
              </g>
            ))}

          {/* crosshair */}
          {hover && (
            <g className="pc-hover">
              <line x1={hover.px} x2={hover.px} y1={M.top} y2={M.top + innerH} />
              {hover.now != null && <circle className="now" cx={hover.px} cy={hover.now} r={4.5} />}
              <circle className="exp" cx={hover.px} cy={hover.exp} r={4.5} />
            </g>
          )}
        </svg>
      )}
      {tip.node}
    </div>
  );
}

/** Legend for the two payoff curves (kept outside the SVG so it sits in the card header). */
export function PayoffLegend({ scenarioLabel, showScenario, guide }: { scenarioLabel: string; showScenario: boolean; guide?: boolean }) {
  return (
    <div className="pc-legend">
      <span>
        <i className="sw exp" /> At expiration
      </span>
      {showScenario && (
        <span>
          <i className="sw now" /> {scenarioLabel}
        </span>
      )}
      <span>
        <i className="sw band" /> ±1σ move
      </span>
      {guide && (
        <span className="rx-text">
          <i className="sw rx" /> Guide
        </span>
      )}
    </div>
  );
}
