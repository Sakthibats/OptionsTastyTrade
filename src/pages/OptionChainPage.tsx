import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { useMarketMetrics, useNestedChain } from "../api/queries";
import { yearsToExpiry } from "../analytics/blackScholes";
import { buildLattice, nearTheMoney, rowsOf, type ChainRow, type Lattice } from "../analytics/chain";
import type { Session } from "../analytics/market";
import { formatDate, formatStrike, heatScale, heatStyle, METRICS, metricValue, num, pct, price, type HeatScale, type MetricKey } from "../analytics/metrics";
import { optionQuote, type OptionQuote } from "../analytics/optionQuote";
import { ErrorBox } from "../components/ErrorBox";
import { QuoteCard } from "../components/QuoteCard";
import { ExpirationSelect, Field, Flash, HeatLegend, Meter, Segmented, RefreshButton, SessionPill, Stat, StatusPill, SymbolSearch, useTooltip, type TipContent } from "../components/ui";
import { useNow, useRefresh, useSession, useUnderlying } from "../hooks";
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

export function OptionChainPage({ symbol, onSymbol }: { symbol: string; onSymbol: (s: string) => void }) {
  const [view, setView] = useState<View>(() => (new URLSearchParams(location.search).get("view") === "heatmap" ? "heatmap" : "chain"));
  const [metric, setMetric] = useState<MetricKey>("openInterest");
  const [side, setSide] = useState<Side>("call");
  const [expIndex, setExpIndex] = useState(0);
  useEffect(() => setExpIndex(0), [symbol]);

  const chain = useNestedChain(symbol);
  const metrics = useMarketMetrics(symbol ? [symbol] : []);
  const expirations = chain.data?.[0]?.expirations ?? [];
  const expiration = expirations[expIndex];
  const sessionInfo = useSession();

  // One DXLink connection for the page. Which contracts to subscribe to depends on
  // spot, and spot comes from the stream, so the list lives in state.
  const [subs, setSubs] = useState<Subscription[]>([]);
  const { status, latest, lastUpdate, reconnect } = useMarketData(subs);
  const { refresh, busy } = useRefresh(reconnect);
  const now = useNow();

  const underlying = useUnderlying(symbol, latest);
  const spotInfo = underlying.spot;
  const spot = spotInfo.price;

  const rows = useMemo(() => (expiration ? nearTheMoney(rowsOf(expiration), spot, CHAIN_STRIKES_EACH_SIDE) : []), [expiration, spot]);
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
        <SymbolSearch symbol={symbol} onSymbol={onSymbol} />
        <Segmented label="View" options={VIEW_OPTIONS} value={view} onChange={setView} />
        {view === "chain" && <ExpirationSelect expirations={expirations} index={expIndex} onChange={setExpIndex} />}
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
        <RefreshButton onRefresh={refresh} busy={busy} lastUpdate={lastUpdate} now={now} />
      </div>

      <div className="summary">
        <QuoteCard symbol={symbol} spot={spotInfo} session={sessionInfo.session} loadingYahoo={underlying.yahooLoading} yahooError={underlying.yahooError} />
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

/* ================================================================ Chain view */

type ColKey = "volume" | "openInterest" | "iv" | "delta" | "bid" | "ask";
const CALL_COLS: ColKey[] = ["volume", "openInterest", "iv", "delta", "bid", "ask"];
const PUT_COLS: ColKey[] = ["bid", "ask", "delta", "iv", "openInterest", "volume"];
const COL_LABEL: Record<ColKey, string> = { volume: "Volume", openInterest: "Open int", iv: "IV", delta: "Delta", bid: "Bid", ask: "Ask" };

type SideCell = OptionQuote;

function heatValue(cell: SideCell, metric: MetricKey): number | undefined {
  const v = cell[metric as keyof Pick<SideCell, MetricKey>];
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
        call: optionQuote(latest, r.callStreamer, "call", r.strike, spot, t),
        put: optionQuote(latest, r.putStreamer, "put", r.strike, spot, t),
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

/* ================================================================ helpers */

function latticeSymbols(l: Lattice, side: Side): string[] {
  return l.columns.flatMap((c) =>
    l.strikes.flatMap((k) => {
      const row = c.byStrike.get(k);
      const s = side === "call" ? row?.callStreamer : row?.putStreamer;
      return s ? [s] : [];
    }),
  );
}
