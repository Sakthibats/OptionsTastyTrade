import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { useMarketMetrics, useNestedChain, useSnapshot, useYahooQuote } from "../api/queries";
import type { NestedExpiration } from "../api/types";
import { greeks, impliedVol, yearsToExpiry } from "../analytics/blackScholes";
import { buildLattice, nearTheMoney, toRows, type ChainRow, type Lattice } from "../analytics/chain";
import { resolveSpot, usEquitySession, type Session, type SessionInfo, type Spot } from "../analytics/market";
import { heatScale, heatStyle, METRICS, metricValue, num, pct, price, type HeatScale, type MetricKey } from "../analytics/metrics";
import { ErrorBox } from "../components/ErrorBox";
import { Field, Flash, HeatLegend, Meter, RangeBar, Segmented, SessionPill, Stat, StatusPill, useTooltip, type TipContent } from "../components/ui";
import type { EventType, MarketEvent, Subscription } from "../streaming/dxlink";
import { useMarketData } from "../streaming/useMarketData";

type View = "chain" | "heatmap";
type Side = "call" | "put";

const VIEW_OPTIONS = [
  { value: "chain", label: "Chain" },
  { value: "heatmap", label: "Heatmap" },
] as const;
const METRIC_OPTIONS = (Object.keys(METRICS) as MetricKey[]).map((k) => ({ value: k, label: METRICS[k].label }));
const SIDE_OPTIONS = [
  { value: "call", label: "Calls" },
  { value: "put", label: "Puts" },
] as const;

const CHAIN_STRIKES_EACH_SIDE = 12;
const HEATMAP_STRIKES_EACH_SIDE = 12;
const HEATMAP_EXPIRATIONS = 8;
const CHAIN_EVENTS: EventType[] = ["Quote", "Greeks", "Summary", "Trade"];
/** Used only for locally estimated greeks when the stream sends none. */
const RISK_FREE_RATE = 0.045;
/** Wait this long for a streamed/snapshot price before asking Yahoo. */
const YAHOO_FALLBACK_DELAY_MS = 4000;

export function OptionChainPage() {
  const [input, setInput] = useState("SPY");
  const [symbol, setSymbol] = useState("SPY");
  const [view, setView] = useState<View>(() => (new URLSearchParams(location.search).get("view") === "heatmap" ? "heatmap" : "chain"));
  const [metric, setMetric] = useState<MetricKey>("openInterest");
  const [side, setSide] = useState<Side>("call");
  const [expIndex, setExpIndex] = useState(0);

  const chain = useNestedChain(symbol);
  const metrics = useMarketMetrics(symbol ? [symbol] : []);
  const expirations = chain.data?.[0]?.expirations ?? [];
  const expiration = expirations[expIndex];
  const sessionInfo = useSession();

  // One DXLink connection for the page. Which contracts to subscribe to depends on
  // spot, and spot comes from the stream, so the list lives in state.
  const [subs, setSubs] = useState<Subscription[]>([]);
  const { status, latest } = useMarketData(subs);

  // Underlying price: live quote → last trade → REST snapshot → Yahoo Finance.
  const snapshot = useSnapshot(symbol);
  const uQuote = latest.get(`Quote:${symbol}`);
  const uTrade = latest.get(`Trade:${symbol}`);
  const uSummary = latest.get(`Summary:${symbol}`);
  const withoutYahoo = resolveSpot(uQuote, uTrade, uSummary, snapshot.data, undefined);
  const needYahoo = useStuck(withoutYahoo.price == null, YAHOO_FALLBACK_DELAY_MS, symbol);
  const yahoo = useYahooQuote(symbol, needYahoo);
  const spotInfo = yahoo.data ? resolveSpot(uQuote, uTrade, uSummary, snapshot.data, yahoo.data) : withoutYahoo;
  const spot = spotInfo.price;

  const rows = useMemo(() => (expiration ? nearTheMoney(toRowsCached(expiration), spot, CHAIN_STRIKES_EACH_SIDE) : []), [expiration, spot]);
  const lattice = useMemo(
    () => buildLattice(expirations.slice(0, HEATMAP_EXPIRATIONS), spot, HEATMAP_STRIKES_EACH_SIDE),
    [expirations, spot],
  );

  const nextSubs = useMemo<Subscription[]>(() => {
    const base: Subscription[] = (["Quote", "Trade", "Summary"] as EventType[]).map((type) => ({ type, symbol }));
    if (view === "chain") {
      return [...base, ...rows.flatMap((r) => [r.callStreamer, r.putStreamer].flatMap((s) => CHAIN_EVENTS.map((type) => ({ type, symbol: s }))))];
    }
    const type = METRICS[metric].event;
    return [...base, ...latticeSymbols(lattice, side).map((s) => ({ type, symbol: s }))];
  }, [symbol, view, rows, lattice, metric, side]);
  const nextKey = nextSubs.map((s) => `${s.type}:${s.symbol}`).join("|");
  useEffect(() => setSubs(nextSubs), [nextKey]);

  const m = metrics.data?.[0];
  const ivIndex = num(m?.["implied-volatility-index"]);
  const ivRank = num(m?.["implied-volatility-index-rank"]);
  const ivPctl = num(m?.["implied-volatility-percentile"]);

  return (
    <div className="page">
      <div className="toolbar">
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            const next = input.trim().toUpperCase();
            if (next) {
              setSymbol(next);
              setExpIndex(0);
            }
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M8.5 3a5.5 5.5 0 1 0 3.4 9.8l3.6 3.7 1.1-1.1-3.7-3.6A5.5 5.5 0 0 0 8.5 3Zm0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" />
          </svg>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Symbol" aria-label="Symbol" spellCheck={false} />
        </form>
        <Segmented label="View" options={VIEW_OPTIONS} value={view} onChange={setView} />
        {view === "chain" && (
          <Field label="Expiration">
            <select value={expIndex} onChange={(e) => setExpIndex(Number(e.target.value))}>
              {expirations.map((x, i) => (
                <option key={x["expiration-date"]} value={i}>
                  {formatDate(x["expiration-date"])} · {x["days-to-expiration"]}d{x["expiration-type"] === "Regular" ? " · M" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Color by">
          <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>
            {METRIC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        {view === "heatmap" && <Segmented label="Side" options={SIDE_OPTIONS} value={side} onChange={setSide} />}
        <span className="toolbar-spacer" />
        <SessionPill info={sessionInfo} />
        <StatusPill status={status} />
      </div>

      <div className="summary">
        <QuoteCard symbol={symbol} spot={spotInfo} session={sessionInfo.session} loadingYahoo={yahoo.isFetching} yahooError={yahoo.isError} />
        <div className="stats-row">
          <Stat label="IV index" value={ivIndex != null ? pct(ivIndex) : undefined} sub="30-day implied" />
          <Stat label="IV rank" value={ivRank != null ? pct(ivRank, 0) : undefined}>
            <Meter value={ivRank} />
          </Stat>
          <Stat label="IV percentile" value={ivPctl != null ? pct(ivPctl, 0) : undefined}>
            <Meter value={ivPctl} />
          </Stat>
          {view === "chain" && expiration ? (
            <Stat label="Expiration" value={`${expiration["days-to-expiration"]}d`} sub={`${formatDate(expiration["expiration-date"])} · ${expiration["expiration-type"]}`} />
          ) : (
            <Stat label="Expirations shown" value={String(lattice.columns.length)} sub={`${lattice.strikes.length} strikes around spot`} />
          )}
        </div>
      </div>

      <ErrorBox error={chain.error ?? metrics.error} />

      {view === "chain" ? (
        <ChainTable
          rows={rows}
          spot={spot}
          symbol={symbol}
          expiration={expiration?.["expiration-date"]}
          latest={latest}
          metric={metric}
          loading={chain.isLoading}
          session={sessionInfo.session}
        />
      ) : (
        <Heatmap lattice={lattice} spot={spot} latest={latest} metric={metric} side={side} loading={chain.isLoading} session={sessionInfo.session} />
      )}
    </div>
  );
}

/* ================================================================ Quote card */

function QuoteCard({ symbol, spot, session, loadingYahoo, yahooError }: { symbol: string; spot: Spot; session: Session; loadingYahoo: boolean; yahooError: boolean }) {
  const change = spot.price != null && spot.prevClose ? spot.price - spot.prevClose : undefined;
  const changePct = change != null && spot.prevClose ? change / spot.prevClose : undefined;
  const tone = change == null ? "" : change >= 0 ? "up" : "down";
  const closedNote = session === "closed" && spot.source !== "live quote" ? " · last session" : "";

  return (
    <section className={`quote-card ${tone ? `tone-${tone}` : ""}`}>
      <div className="quote-top">
        <span className="quote-symbol">{symbol}</span>
        {spot.source && (
          <span className={`source-tag ${spot.source === "Yahoo Finance" ? "ext" : ""}`} title="Where this price comes from">
            {spot.source}
            {closedNote}
          </span>
        )}
      </div>
      <div className="quote-main">
        <Flash value={spot.price} className="quote-price">
          {spot.price != null ? spot.price.toFixed(2) : loadingYahoo ? "Loading…" : "–"}
        </Flash>
        {change != null && changePct != null && (
          <span className={`change-chip ${tone}`}>
            {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)} ({change >= 0 ? "+" : ""}
            {pct(changePct, 2)})
          </span>
        )}
      </div>
      <div className="quote-foot">
        {spot.bid != null && spot.ask != null ? (
          <span className="muted">
            Bid {spot.bid.toFixed(2)} · Ask {spot.ask.toFixed(2)}
          </span>
        ) : spot.price == null && yahooError ? (
          <span className="down">No price from tastytrade or Yahoo Finance</span>
        ) : (
          <span className="muted">{spot.prevClose ? `Prev close ${spot.prevClose.toFixed(2)}` : ""}</span>
        )}
        <RangeBar low={spot.dayLow} high={spot.dayHigh} value={spot.price} />
      </div>
    </section>
  );
}

/* ================================================================ Chain view */

type ColKey = "volume" | "openInterest" | "iv" | "delta" | "bid" | "ask";
const CALL_COLS: ColKey[] = ["volume", "openInterest", "iv", "delta", "bid", "ask"];
const PUT_COLS: ColKey[] = ["bid", "ask", "delta", "iv", "openInterest", "volume"];
const COL_LABEL: Record<ColKey, string> = { volume: "Volume", openInterest: "Open int", iv: "IV", delta: "Delta", bid: "Bid", ask: "Ask" };

interface SideCell {
  bid?: number;
  ask?: number;
  iv?: number;
  delta?: number;
  openInterest?: number;
  volume?: number;
  /** IV/delta estimated locally from the mid price because the stream sent no greeks. */
  estimated: boolean;
  itm: boolean;
}

function sideCell(streamer: string, type: Side, strike: number, spot: number | undefined, t: number, latest: Map<string, MarketEvent>): SideCell {
  const q = latest.get(`Quote:${streamer}`);
  const g = latest.get(`Greeks:${streamer}`);
  const bid = positive(q?.bidPrice);
  const ask = positive(q?.askPrice);
  let iv = positive(g?.volatility);
  let delta = num(g?.delta) ?? undefined;
  let estimated = false;

  if ((iv == null || delta == null) && spot && t > 0 && bid != null && ask != null) {
    const vol = impliedVol((bid + ask) / 2, { type, spot, strike, t, rate: RISK_FREE_RATE });
    if (Number.isFinite(vol)) {
      iv ??= vol;
      delta ??= greeks({ type, spot, strike, t, vol, rate: RISK_FREE_RATE }).delta;
      estimated = true;
    }
  }

  return {
    bid,
    ask,
    iv,
    delta,
    openInterest: num(latest.get(`Summary:${streamer}`)?.openInterest) ?? undefined,
    volume: num(latest.get(`Trade:${streamer}`)?.dayVolume) ?? undefined,
    estimated,
    itm: spot != null && (type === "call" ? strike < spot : strike > spot),
  };
}

function heatValue(cell: SideCell, metric: MetricKey): number | undefined {
  const v = cell[metric];
  return v == null ? undefined : metric === "delta" ? Math.abs(v) : v;
}

function ChainTable({
  rows,
  spot,
  symbol,
  expiration,
  latest,
  metric,
  loading,
  session,
}: {
  rows: ChainRow[];
  spot?: number;
  symbol: string;
  expiration?: string;
  latest: Map<string, MarketEvent>;
  metric: MetricKey;
  loading: boolean;
  session: Session;
}) {
  const tip = useTooltip();
  const def = METRICS[metric];
  const t = expiration ? yearsToExpiry(expiration) : 0;

  const model = useMemo(
    () =>
      rows.map((r) => ({
        row: r,
        call: sideCell(r.callStreamer, "call", r.strike, spot, t, latest),
        put: sideCell(r.putStreamer, "put", r.strike, spot, t, latest),
      })),
    [rows, spot, t, latest],
  );
  const scale = useMemo(() => heatScale(model.flatMap((m) => [heatValue(m.call, metric), heatValue(m.put, metric)]), def.scale), [model, metric, def.scale]);
  const anyEstimated = model.some((m) => m.call.estimated || m.put.estimated);
  const spotAt = spot == null ? -1 : rows.findIndex((r) => r.strike > spot);

  return (
    <section className="card">
      <div className="card-head">
        <div className="side-labels">
          <span className="side-tag call">Calls</span>
          <span className="side-tag put">Puts</span>
        </div>
        <HeatLegend title={def.label} scale={scale} format={def.format} />
      </div>
      <div className="table-scroll">
        <table className="chain">
          <thead>
            <tr>
              {CALL_COLS.map((c) => (
                <th key={`c-${c}`} className={c === metric ? "heat-col" : ""}>
                  {COL_LABEL[c]}
                </th>
              ))}
              <th className="strike">Strike</th>
              {PUT_COLS.map((c) => (
                <th key={`p-${c}`} className={c === metric ? "heat-col" : ""}>
                  {COL_LABEL[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.map((m, i) => (
              <ChainRowView key={m.row.strike} m={m} spot={spot} symbol={symbol} metric={metric} scale={scale} tip={tip} spotBefore={i === spotAt} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={13} className="empty">
                  {loading ? "Loading chain…" : "No strikes."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ChainFoot session={session} estimated={anyEstimated} />
      {tip.node}
    </section>
  );
}

function ChainRowView({
  m,
  spot,
  symbol,
  metric,
  scale,
  tip,
  spotBefore,
}: {
  m: { row: ChainRow; call: SideCell; put: SideCell };
  spot?: number;
  symbol: string;
  metric: MetricKey;
  scale: HeatScale;
  tip: ReturnType<typeof useTooltip>;
  spotBefore: boolean;
}) {
  const strike = m.row.strike;

  const cell = (side: Side, col: ColKey) => {
    const c = side === "call" ? m.call : m.put;
    const v = c[col];
    const isHeat = col === metric;
    const hv = isHeat ? heatValue(c, metric) : undefined;
    const est = c.estimated && (col === "iv" || col === "delta");
    const isPx = col === "bid" || col === "ask";
    const text = isPx ? price(v) : v == null ? "–" : METRICS[col as MetricKey].format(v);

    const content: TipContent | null =
      isHeat && hv != null
        ? {
            value: METRICS[metric].format(hv),
            label: `${METRICS[metric].label} · ${formatStrike(strike)} ${side}`,
            rows: [
              ["Bid / Ask", `${price(c.bid)} / ${price(c.ask)}`],
              ["Moneyness", c.itm ? "In the money" : "Out of the money"],
              ...(est ? ([["Source", "estimated from mid"]] as Array<[string, string]>) : []),
            ],
          }
        : null;

    const classes = ["num", c.itm ? `itm-${side}` : "", isHeat ? "heat" : "", est ? "est" : "", isPx ? "px" : ""].join(" ");

    return (
      <td
        key={`${side}-${col}`}
        className={classes}
        style={isHeat ? heatStyle(scale.bin(hv)) : undefined}
        title={est ? "Estimated locally from the mid price (no streamed greeks)" : undefined}
        onPointerEnter={content ? (e: PointerEvent) => tip.show(e, content) : undefined}
        onPointerMove={content ? (e: PointerEvent) => tip.show(e, content) : undefined}
        onPointerLeave={content ? tip.hide : undefined}
      >
        {isPx ? <Flash value={v}>{text}</Flash> : text}
      </td>
    );
  };

  return (
    <>
      {spotBefore && spot != null && (
        <tr className="spot-row" aria-label={`${symbol} spot ${spot.toFixed(2)}`}>
          <td colSpan={13}>
            <span className="spot-chip">
              {symbol} {spot.toFixed(2)}
            </span>
          </td>
        </tr>
      )}
      <tr className="chain-row">
        {CALL_COLS.map((c) => cell("call", c))}
        <td className="strike">{formatStrike(strike)}</td>
        {PUT_COLS.map((c) => cell("put", c))}
      </tr>
    </>
  );
}

function ChainFoot({ session, estimated }: { session: Session; estimated: boolean }) {
  const notes: string[] = [];
  if (session !== "regular") {
    notes.push(
      session === "closed"
        ? "Market closed: quotes and greeks are from the last session; volume resets at the next open."
        : "Extended hours: option quotes can be stale or wide until the regular session.",
    );
  }
  if (estimated) notes.push("Italic IV/delta are estimated locally from the mid price.");
  if (!notes.length) return null;
  return <div className="card-foot">{notes.join(" ")}</div>;
}

/* ================================================================ Heatmap view */

function Heatmap({
  lattice,
  spot,
  latest,
  metric,
  side,
  loading,
  session,
}: {
  lattice: Lattice;
  spot?: number;
  latest: Map<string, MarketEvent>;
  metric: MetricKey;
  side: Side;
  loading: boolean;
  session: Session;
}) {
  const tip = useTooltip();
  const def = METRICS[metric];
  const [hover, setHover] = useState<{ strike: number; date: string } | null>(null);
  const streamerOf = (row?: ChainRow) => (side === "call" ? row?.callStreamer : row?.putStreamer);

  const scale = useMemo(
    () => heatScale(lattice.columns.flatMap((c) => lattice.strikes.map((k) => metricValue(metric, latest, streamerOf(c.byStrike.get(k))))), def.scale),
    [lattice, latest, metric, side, def.scale],
  );
  const spotAt = spot == null ? -1 : lattice.strikes.findIndex((k) => k > spot);

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <span className={`side-tag ${side}`}>{side === "call" ? "Calls" : "Puts"}</span>
          {def.label} by strike and expiration
        </div>
        <HeatLegend title={def.label} scale={scale} format={def.format} />
      </div>
      <div className="table-scroll" onPointerLeave={() => setHover(null)}>
        <table className="lattice">
          <thead>
            <tr>
              <th className="strike">Strike</th>
              {lattice.columns.map((c) => (
                <th key={c.date} className={hover?.date === c.date ? "hl" : ""}>
                  <div>{formatDate(c.date)}</div>
                  <div className="th-sub">
                    {c.dte}d{c.weekly ? "" : " · M"}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lattice.strikes.map((k, i) => {
              const itmRow = spot != null && (side === "call" ? k < spot : k > spot);
              return (
                <tr key={k} className={i === spotAt ? "spot-above" : ""}>
                  <td className={`strike ${hover?.strike === k ? "hl" : ""} ${itmRow ? `itm-${side}` : ""}`}>{formatStrike(k)}</td>
                  {lattice.columns.map((c) => {
                    const row = c.byStrike.get(k);
                    const v = metricValue(metric, latest, streamerOf(row));
                    const content: TipContent | null =
                      v != null
                        ? {
                            value: def.format(v),
                            label: `${def.label} · ${formatStrike(k)} ${side}`,
                            rows: [
                              ["Expiration", `${formatDate(c.date)} (${c.dte}d)`],
                              ["Moneyness", itmRow ? "In the money" : "Out of the money"],
                            ],
                          }
                        : null;
                    return (
                      <td
                        key={c.date}
                        className={`cell ${row ? "" : "missing"}`}
                        style={heatStyle(scale.bin(v))}
                        onPointerEnter={(e: PointerEvent) => {
                          setHover({ strike: k, date: c.date });
                          if (content) tip.show(e, content);
                        }}
                        onPointerMove={content ? (e: PointerEvent) => tip.show(e, content) : undefined}
                        onPointerLeave={tip.hide}
                      >
                        {v != null ? def.format(v) : row ? "–" : ""}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {lattice.strikes.length === 0 && (
              <tr>
                <td colSpan={lattice.columns.length + 1} className="empty">
                  {loading ? "Loading chain…" : "No strikes."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="card-foot">
        {spot != null ? `Blue line marks spot (${spot.toFixed(2)}). ` : ""}
        {session === "closed" ? "Market closed: values are from the last session. " : ""}
        Hover a cell for details.
      </div>
      {tip.node}
    </section>
  );
}

/* ================================================================ hooks & helpers */

/** Re-evaluates the US equity session every 30 seconds. */
function useSession(): SessionInfo {
  const [info, setInfo] = useState(() => usEquitySession());
  useEffect(() => {
    const id = setInterval(() => setInfo(usEquitySession()), 30_000);
    return () => clearInterval(id);
  }, []);
  return info;
}

/** True once `condition` has held for `ms` without interruption. Resets when `resetKey` changes. */
function useStuck(condition: boolean, ms: number, resetKey: string): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    setStuck(false);
    if (!condition) return;
    const id = setTimeout(() => setStuck(true), ms);
    return () => clearTimeout(id);
  }, [condition, ms, resetKey]);
  return stuck;
}

const rowsCache = new WeakMap<NestedExpiration, ChainRow[]>();
function toRowsCached(exp: NestedExpiration): ChainRow[] {
  let r = rowsCache.get(exp);
  if (!r) rowsCache.set(exp, (r = toRows(exp)));
  return r;
}

function latticeSymbols(l: Lattice, side: Side): string[] {
  return l.columns.flatMap((c) =>
    l.strikes.flatMap((k) => {
      const row = c.byStrike.get(k);
      const s = side === "call" ? row?.callStreamer : row?.putStreamer;
      return s ? [s] : [];
    }),
  );
}

function positive(v: unknown): number | undefined {
  const n = num(v);
  return n != null && n > 0 ? n : undefined;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatStrike(k: number): string {
  return Number.isInteger(k) ? String(k) : k.toFixed(2).replace(/0$/, "");
}
