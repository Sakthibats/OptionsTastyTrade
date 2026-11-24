import { useState, type MouseEvent, type PointerEvent } from "react";
import { APPETITE_LABEL, type Appetite, type Guide } from "../analytics/guide";
import { formatStrike, pct, signedPct } from "../analytics/metrics";
import type { LadderRow } from "../analytics/payoff";
import { useWidth } from "../hooks";
import { linear, niceTicks, padExtent, pathOf, type Scale } from "./chart";
import { useTooltip, type TipContent } from "./ui";

const PANEL_H = 210;
const AXIS_H = 26;
const M = { top: 34, right: 20, left: 64 };

interface Panel {
  title: string;
  hint: string;
  value: (r: LadderRow) => number | undefined;
  format: (v: number) => string;
  /** Fixed y-domain (e.g. probabilities) instead of fitting the data. */
  domain?: [number, number];
  refs: Array<{ v: number; label: string }>;
}

/** Guide overlay for the ladder (prescriptive layer, drawn in the guide color). */
export interface LadderGuide {
  guide: Guide;
  active: Appetite;
}

/**
 * Small multiples stacked on one shared strike axis: where the breakeven lands,
 * the chance of profit, and the return. Read down a column to see what moving the
 * strike buys and costs. Hover syncs all three; click picks a strike. The magenta
 * band and lines are the strike guide (prescriptive), everything blue is data.
 */
export function StrikeLadder({
  rows,
  spot,
  selected,
  onSelect,
  seller,
  sigmaMove,
  targetLabel,
  guide,
}: {
  rows: LadderRow[];
  spot: number;
  selected?: number;
  onSelect: (strike: number) => void;
  seller: boolean;
  /** Lognormal ±1σ move as fractions of spot: [down (negative), up]. */
  sigmaMove: [number, number];
  /** Buyer target description, e.g. "+4.2% (1σ up)". */
  targetLabel: string;
  guide?: LadderGuide;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTooltip();

  const panels: Panel[] = [
    {
      title: "Breakeven vs. spot",
      hint: seller ? "How far the stock can move against you before you lose money" : "How far the stock must move before you make money",
      value: (r) => r.distance,
      format: (v) => signedPct(v, 1),
      refs: [
        { v: sigmaMove[1], label: "+1σ move" },
        { v: sigmaMove[0], label: "−1σ move" },
        { v: 0, label: "" },
      ],
    },
    {
      title: "Chance of profit",
      hint: "At expiration, from each strike's implied vol",
      value: (r) => r.pop,
      format: (v) => pct(v, 0),
      domain: [0, 1],
      refs: [{ v: 0.5, label: "50%" }],
    },
    seller
      ? {
          title: "Return if unchanged, annualized",
          hint: "Premium kept if the stock stays put, scaled to a year",
          value: (r) => r.annualized ?? r.ret,
          format: (v) => pct(v, v < 0.1 ? 1 : 0),
          refs: [],
        }
      : {
          title: "Return at a 1σ move",
          hint: `If the stock ends ${targetLabel}`,
          value: (r) => r.ret,
          format: (v) => signedPct(v, 0),
          refs: [{ v: 0, label: "" }],
        },
  ];

  const kMin = rows[0]?.strike ?? 0;
  const kMax = rows.at(-1)?.strike ?? 1;
  const innerW = Math.max(0, width - M.left - M.right);
  const x = linear([kMin, kMax], [M.left, M.left + innerW]);
  const levelsAt = (k: number) => guide?.guide.levels.filter((l) => l.strike === k) ?? [];

  const nearest = (e: MouseEvent<SVGSVGElement>) => {
    const k = x.invert(e.clientX - e.currentTarget.getBoundingClientRect().left);
    let best = rows[0]!;
    for (const r of rows) if (Math.abs(r.strike - k) < Math.abs(best.strike - k)) best = r;
    return best;
  };

  const showTip = (e: PointerEvent, r: LadderRow) => {
    const lv = levelsAt(r.strike);
    const extra: Array<[string, string]> = [];
    if (seller && r.annualized != null) extra.push(["Annualized", pct(r.annualized, 1)]);
    if (seller && r.maxRet != null) extra.push(["Max return", pct(r.maxRet, 2)]);
    if (lv.length) extra.push(["Guide", lv.map((l) => `${APPETITE_LABEL[l.appetite]} (${Math.round(l.delta * 100)}Δ)`).join(", ")]);
    const content: TipContent = {
      value: `${formatStrike(r.strike)} strike`,
      label: `Premium ${r.premium.toFixed(2)} · IV ${pct(r.iv, 1)}${r.delta != null ? ` · Δ ${r.delta.toFixed(2)}` : ""}`,
      rows: [
        ["Breakeven", `${r.breakeven.toFixed(2)} (${signedPct(r.distance)})`],
        ["Chance of profit", pct(r.pop, 0)],
        seller ? ["Return if unchanged", pct(r.ret, 2)] : ["Return at 1σ move", signedPct(r.ret, 0)],
        ...extra,
      ],
    };
    tip.show(e, content);
  };

  return (
    <div className="ladder-stack" ref={ref} onPointerLeave={() => (setHover(null), tip.hide())}>
      {!rows.length && <div className="empty-block">Waiting for option quotes…</div>}
      {rows.length > 0 &&
        width > 0 &&
        panels.map((p, i) => (
          <LadderPanel
            key={p.title}
            panel={p}
            rows={rows}
            x={x}
            width={width}
            innerW={innerW}
            spot={spot}
            selected={selected}
            hover={hover}
            guide={guide}
            first={i === 0}
            last={i === panels.length - 1}
            onMove={(e) => {
              const r = nearest(e);
              setHover(r.strike);
              showTip(e, r);
            }}
            onClick={(e) => onSelect(nearest(e).strike)}
          />
        ))}
      {tip.node}
    </div>
  );
}

function LadderPanel({
  panel,
  rows,
  x,
  width,
  innerW,
  spot,
  selected,
  hover,
  guide,
  first,
  last,
  onMove,
  onClick,
}: {
  panel: Panel;
  rows: LadderRow[];
  x: Scale;
  width: number;
  innerW: number;
  spot: number;
  selected?: number;
  hover: number | null;
  guide?: LadderGuide;
  first: boolean;
  last: boolean;
  onMove: (e: PointerEvent<SVGSVGElement>) => void;
  onClick: (e: MouseEvent<SVGSVGElement>) => void;
}) {
  const height = PANEL_H + (last ? AXIS_H : 0);
  const plotBottom = PANEL_H - 6;
  const pts = rows.flatMap((r) => {
    const v = panel.value(r);
    return v != null && Number.isFinite(v) ? [{ r, v }] : [];
  });
  if (!pts.length) return null;
  const vals = pts.map((p) => p.v);
  const refVals = panel.refs.map((r) => r.v);
  const [y0, y1] = panel.domain ?? padExtent(Math.min(...vals, ...refVals), Math.max(...vals, ...refVals), 0.08);
  const y = linear([y0, y1], [plotBottom, M.top]);
  const kMin = rows[0]!.strike;
  const kMax = rows.at(-1)!.strike;
  const sel = pts.find((p) => p.r.strike === selected);
  const hov = pts.find((p) => p.r.strike === hover);

  // Guide: band across the three appetites, one dashed line per distinct strike.
  const g = guide?.guide;
  const zoneX0 = g ? x(g.zone[0]) : 0;
  const zoneX1 = g ? x(g.zone[1]) : 0;
  const byStrike = new Map<number, Appetite[]>();
  for (const l of g?.levels ?? []) byStrike.set(l.strike, [...(byStrike.get(l.strike) ?? []), l.appetite]);
  // Short delta labels ("16Δ · 30Δ"); raise every other one when neighbors are too close to read.
  let lastX = -Infinity;
  let lastRaised = true;
  const guideMarks = [...byStrike]
    .sort(([a], [b]) => a - b)
    .map(([k, apps]) => {
      const label = apps.map((a) => `${Math.round(g!.levels.find((l) => l.appetite === a)!.delta * 100)}Δ`).join(" · ");
      const raised = x(k) - lastX < 44 ? !lastRaised : false;
      lastX = x(k);
      lastRaised = raised;
      return { k, apps, label, raised };
    });

  return (
    <div className="ladder-panel">
      <div className="ladder-head">
        <span className="ladder-title">{panel.title}</span>
        <span className="ladder-hint">{panel.hint}</span>
      </div>
      <svg width={width} height={height} onPointerMove={onMove} onClick={onClick} role="img" aria-label={`${panel.title} by strike`}>
        {g && <rect className="rx-zone" x={Math.min(zoneX0, zoneX1) - 6} y={M.top - (first ? 28 : 16)} width={Math.abs(zoneX1 - zoneX0) + 12} height={plotBottom - M.top + (first ? 28 : 16)} rx={4} />}

        {niceTicks(y0, y1, 4).map((v) => (
          <g key={v}>
            <line className="pc-grid" x1={M.left} x2={M.left + innerW} y1={y(v)} y2={y(v)} />
            <text className="lp-axis" x={M.left - 8} y={y(v) + 4} textAnchor="end">
              {panel.format(v)}
            </text>
          </g>
        ))}
        {last &&
          niceTicks(kMin, kMax, Math.max(3, Math.floor(innerW / 80))).map((v) => (
            <text key={v} className="lp-axis" x={x(v)} y={height - 8} textAnchor="middle">
              {formatStrike(v)}
            </text>
          ))}
        {panel.refs.map((r) =>
          r.v >= y0 && r.v <= y1 ? (
            <g key={`${r.label}${r.v}`}>
              <line className={r.label ? "lp-ref" : "pc-zero"} x1={M.left} x2={M.left + innerW} y1={y(r.v)} y2={y(r.v)} />
              {r.label && (
                <text className="lp-ref-label" x={M.left + 4} y={y(r.v) - 5}>
                  {r.label}
                </text>
              )}
            </g>
          ) : null,
        )}
        {spot >= kMin && spot <= kMax && (
          <g>
            <line className="lp-spot" x1={x(spot)} x2={x(spot)} y1={M.top} y2={plotBottom} />
            {first && (
              <text className="lp-spot-label" x={x(spot) + 4} y={plotBottom - 4}>
                spot {spot.toFixed(2)}
              </text>
            )}
          </g>
        )}

        {guideMarks.map(({ k, apps, label, raised }) => {
          const active = guide != null && apps.includes(guide.active);
          return (
            <g key={`g${k}`}>
              <line className={`rx-line ${active ? "on" : ""}`} x1={x(k)} x2={x(k)} y1={M.top - 16} y2={plotBottom} />
              {first && (
                <text className={`rx-label ${active ? "on" : ""}`} x={x(k)} y={M.top - (raised ? 16 : 4)} textAnchor="middle">
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {sel && <line className="lp-sel-line" x1={x(sel.r.strike)} x2={x(sel.r.strike)} y1={M.top} y2={plotBottom} />}
        <path className="lp-line" d={pathOf(pts.map((p) => [x(p.r.strike), y(p.v)]))} />
        {pts.map((p) => (byStrike.has(p.r.strike) ? <circle key={`gd${p.r.strike}`} className="rx-dot" cx={x(p.r.strike)} cy={y(p.v)} r={4.5} /> : null))}
        {hov && (
          <g>
            <line className="lp-hover-line" x1={x(hov.r.strike)} x2={x(hov.r.strike)} y1={M.top} y2={plotBottom} />
            <circle className="lp-hover" cx={x(hov.r.strike)} cy={y(hov.v)} r={5} />
          </g>
        )}
        {sel && (
          <g>
            <circle className="lp-sel" cx={x(sel.r.strike)} cy={y(sel.v)} r={6} />
            <text className="lp-sel-label" x={x(sel.r.strike) + 9} y={y(sel.v) - 9}>
              {panel.format(sel.v)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

/** The same ladder as a table (the accessible, exact view). Guide rows carry the guide badge. */
export function StrikeLadderTable({
  rows,
  selected,
  onSelect,
  seller,
  guide,
}: {
  rows: LadderRow[];
  selected?: number;
  onSelect: (k: number) => void;
  seller: boolean;
  guide?: LadderGuide;
}) {
  const g = guide?.guide;
  return (
    <div className="table-scroll">
      <table className="ladder">
        <thead>
          <tr>
            <th className="left">Strike</th>
            <th className="left">Guide</th>
            <th>Premium</th>
            <th>IV</th>
            <th>Delta</th>
            <th>Breakeven</th>
            <th>vs. spot</th>
            <th>Chance of profit</th>
            {seller ? (
              <>
                <th>Max return</th>
                <th>If unchanged</th>
                <th>Annualized</th>
              </>
            ) : (
              <th>Return at 1σ</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const lv = g?.levels.filter((l) => l.strike === r.strike) ?? [];
            const inZone = g != null && r.strike >= g.zone[0] && r.strike <= g.zone[1];
            return (
              <tr key={r.strike} className={`${r.strike === selected ? "sel" : ""} ${inZone ? "in-zone" : ""}`} onClick={() => onSelect(r.strike)}>
                <td className="left strong">{formatStrike(r.strike)}</td>
                <td className="left">
                  {lv.map((l) => (
                    <span key={l.appetite} className={`rx-chip ${guide?.active === l.appetite ? "on" : ""}`}>
                      {APPETITE_LABEL[l.appetite]} · {Math.round(l.delta * 100)}Δ
                    </span>
                  ))}
                </td>
                <td>{r.premium.toFixed(2)}</td>
                <td>{pct(r.iv, 1)}</td>
                <td>{r.delta != null ? r.delta.toFixed(2) : "–"}</td>
                <td>{r.breakeven.toFixed(2)}</td>
                <td>{signedPct(r.distance)}</td>
                <td>{pct(r.pop, 0)}</td>
                {seller ? (
                  <>
                    <td>{r.maxRet != null ? pct(r.maxRet, 2) : "–"}</td>
                    <td>{pct(r.ret, 2)}</td>
                    <td>{r.annualized != null ? pct(r.annualized, 1) : "–"}</td>
                  </>
                ) : (
                  <td className={r.ret >= 0 ? "up" : "down"}>{signedPct(r.ret, 0)}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
