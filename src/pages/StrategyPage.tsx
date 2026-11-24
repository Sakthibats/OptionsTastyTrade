import { useEffect, useMemo, useState } from "react";
import { useMarketMetrics, useNestedChain } from "../api/queries";
import { impliedVol, RISK_FREE_RATE, yearsToExpiry } from "../analytics/blackScholes";
import { ladderRows, rowsOf } from "../analytics/chain";
import { formatDate, formatStrike, num, pct, signedPct, usd } from "../analytics/metrics";
import { entryPrice, optionQuote, type Fill, type OptionQuote } from "../analytics/optionQuote";
import {
  breakevens,
  capitalBasis,
  extremes,
  MULTIPLIER,
  sigmaRange,
  singleLeg,
  STRATEGIES,
  strikeLadder,
  type LadderQuote,
  type LadderRow,
  type Strategy,
} from "../analytics/payoff";
import { APPETITE_LABEL, managementPlan, strikeGuide, type Appetite } from "../analytics/guide";
import { ErrorBox } from "../components/ErrorBox";
import { PayoffChart, PayoffLegend, type PayoffMode } from "../components/PayoffChart";
import { QuoteCard } from "../components/QuoteCard";
import { DataGuideLegend, GuideBadge, StrikeGuideCard } from "../components/StrikeGuide";
import { StrikeLadder, StrikeLadderTable } from "../components/StrikeLadder";
import { ExpirationSelect, Meter, RefreshButton, Segmented, SessionPill, StatusPill, SymbolSearch } from "../components/ui";
import { useNow, useRefresh, useSession, useUnderlying } from "../hooks";
import type { EventType, Subscription } from "../streaming/dxlink";
import { useMarketData } from "../streaming/useMarketData";

const STRATEGY_KEYS = Object.keys(STRATEGIES) as Strategy[];
const FILL_OPTIONS = [
  { value: "mid", label: "Mid" },
  { value: "natural", label: "Natural" },
] as const;
const MODE_OPTIONS = [
  { value: "usd", label: "P/L $" },
  { value: "pct", label: "Return %" },
] as const;
const LADDER_VIEWS = [
  { value: "chart", label: "Charts" },
  { value: "table", label: "Table" },
] as const;
/** Expiration picked by default: the first one at least this many days out (premium sellers' usual 30–45 DTE). */
const DEFAULT_MIN_DTE = 25;
const FALLBACK_VOL = 0.25;

export function StrategyPage({ symbol, onSymbol }: { symbol: string; onSymbol: (s: string) => void }) {
  const [strategy, setStrategy] = useState<Strategy>(() => {
    const s = new URLSearchParams(location.search).get("strategy");
    return s && s in STRATEGIES ? (s as Strategy) : "short-put";
  });
  const [expPick, setExpPick] = useState<number | null>(null);
  const [strike, setStrike] = useState<number | null>(null);
  const [contracts, setContracts] = useState(1);
  const [fill, setFill] = useState<Fill>("mid");
  const [mode, setMode] = useState<PayoffMode>("usd");
  const [days, setDays] = useState(0);
  const [ivShift, setIvShift] = useState(0);
  const [ladderView, setLadderView] = useState<"chart" | "table">("chart");
  const [appetite, setAppetite] = useState<Appetite>("balanced");
  const def = STRATEGIES[strategy];
  const seller = def.dir < 0;

  const chain = useNestedChain(symbol);
  const metrics = useMarketMetrics([symbol]);
  const expirations = chain.data?.[0]?.expirations ?? [];
  const autoExp = Math.max(0, expirations.findIndex((e) => e["days-to-expiration"] >= DEFAULT_MIN_DTE));
  const expIndex = Math.min(expPick ?? autoExp, Math.max(0, expirations.length - 1));
  const expiration = expirations[expIndex];
  const expDate = expiration?.["expiration-date"];
  const dte = expiration?.["days-to-expiration"] ?? 0;
  const t = expDate ? yearsToExpiry(expDate) : 0;
  const sessionInfo = useSession();

  // New symbol → default expiration; new symbol/expiration/strategy → auto strike; reset what-ifs.
  useEffect(() => setExpPick(null), [symbol]);
  useEffect(() => setStrike(null), [symbol, expDate, strategy]);
  useEffect(() => setDays(0), [symbol, expDate]);

  const [subs, setSubs] = useState<Subscription[]>([]);
  const { status, latest, lastUpdate, reconnect } = useMarketData(subs);
  const { refresh, busy } = useRefresh(reconnect);
  const now = useNow();
  const underlying = useUnderlying(symbol, latest);
  const spot = underlying.spot.price;

  const ivIndex = num(metrics.data?.[0]?.["implied-volatility-index"]) ?? undefined;
  const volGuess = ivIndex && ivIndex > 0 ? ivIndex : FALLBACK_VOL;
  const ivRank = num(metrics.data?.[0]?.["implied-volatility-index-rank"]) ?? undefined;

  const allRows = useMemo(() => (expiration ? rowsOf(expiration) : []), [expiration]);
  const ladder = useMemo(() => (spot ? ladderRows(allRows, spot, volGuess, t, { keep: strike ?? undefined }) : []), [allRows, spot != null, volGuess, t, strike]);
  const streamerOf = (r: (typeof allRows)[number]) => (def.type === "call" ? r.callStreamer : r.putStreamer);

  const nextSubs = useMemo<Subscription[]>(() => {
    const base: Subscription[] = (["Quote", "Trade", "Summary"] as EventType[]).map((type) => ({ type, symbol }));
    const opt = ladder.flatMap((r) => (["Quote", "Greeks"] as EventType[]).map((type) => ({ type, symbol: streamerOf(r) })));
    return [...base, ...opt];
  }, [symbol, ladder, def.type]);
  const nextKey = nextSubs.map((s) => `${s.type}:${s.symbol}`).join("|");
  useEffect(() => setSubs(nextSubs), [nextKey]);

  // Quotes → ladder rows (premium at the chosen fill, IV streamed or implied from the premium).
  const quotes = useMemo(() => {
    const m = new Map<number, { q: OptionQuote; premium?: number; theo: boolean; iv?: number }>();
    for (const r of ladder) {
      const q = optionQuote(latest, streamerOf(r), def.type, r.strike, spot, t);
      const { price, theo } = entryPrice(q, def.dir, fill);
      let iv = q.iv;
      if (iv == null && price != null && spot && t > 0) {
        const v = impliedVol(price, { type: def.type, spot, strike: r.strike, t, rate: RISK_FREE_RATE });
        if (Number.isFinite(v)) iv = v;
      }
      m.set(r.strike, { q, premium: price, theo, iv });
    }
    return m;
  }, [ladder, latest, spot, t, def.type, def.dir, fill]);

  const atmVol = useMemo(() => {
    if (!spot) return volGuess;
    let best: { d: number; iv: number } | null = null;
    for (const [k, v] of quotes) if (v.iv && (!best || Math.abs(k - spot) < best.d)) best = { d: Math.abs(k - spot), iv: v.iv };
    return best?.iv ?? volGuess;
  }, [quotes, spot, volGuess]);

  const ladderData: LadderRow[] = useMemo(() => {
    if (!spot) return [];
    const input: LadderQuote[] = [];
    for (const [strike, v] of quotes) if (v.premium && v.iv) input.push({ strike, premium: v.premium, iv: v.iv, delta: v.q.delta });
    return strikeLadder(strategy, input, spot, t, RISK_FREE_RATE, atmVol);
  }, [quotes, strategy, spot, t, atmVol]);

  // Strike guide (prescriptive): rule-of-thumb strikes for each risk appetite.
  const guide = useMemo(
    () => (spot ? strikeGuide(strategy, { spot, vol: atmVol, t, dte, rate: RISK_FREE_RATE, ivRank, chain: ladderData.map((r) => ({ strike: r.strike, delta: r.delta })) }) : null),
    [strategy, spot, atmVol, t, dte, ivRank, ladderData],
  );
  const guideLevel = guide?.levels.find((l) => l.appetite === appetite);

  // Auto strike, once per symbol/expiration/strategy: the guide's strike for the chosen appetite.
  useEffect(() => {
    if (strike == null && guideLevel) setStrike(guideLevel.strike);
  }, [strike, guideLevel?.strike]);

  const sel = ladderData.find((r) => r.strike === strike);
  const selQuote = strike != null ? quotes.get(strike) : undefined;
  const legs = useMemo(() => (sel ? [singleLeg(strategy, sel.strike, sel.premium, sel.iv, t, contracts)] : []), [sel?.strike, sel?.premium, sel?.iv, strategy, t, contracts]);
  const bes = useMemo(() => breakevens(legs), [legs]);
  const ext = legs.length ? extremes(legs) : undefined;
  const capitalPerShare = sel && spot ? capitalBasis(strategy, sel.strike, sel.premium, spot) : undefined;
  const capital = capitalPerShare ? capitalPerShare.perShare * MULTIPLIER * contracts : 0;
  const scenario = useMemo(() => ({ daysForward: Math.min(days, t * 365), ivShift, rate: RISK_FREE_RATE }), [days, t, ivShift]);
  const scenarioLabel = days === 0 ? (ivShift ? `Today, IV ${signedPct(ivShift, 0)}` : "Today") : `In ${days}d${ivShift ? `, IV ${signedPct(ivShift, 0)}` : ""}`;
  const [s1lo, s1hi] = spot ? sigmaRange(spot, atmVol, t, 1) : [0, 0];
  const plan = sel ? managementPlan(strategy, sel.premium, contracts, MULTIPLIER, dte, expDate) : [];
  const guideMark = guideLevel ? { strike: guideLevel.strike, label: `${APPETITE_LABEL[guideLevel.appetite].toLowerCase()} ${Math.round(guideLevel.delta * 100)}Δ` } : undefined;
  const ladderGuide = guide ? { guide, active: appetite } : undefined;
  const sigmaMove: [number, number] = spot ? [s1lo / spot - 1, s1hi / spot - 1] : [0, 0];
  const strikeChoices = allRows.map((r) => r.strike);
  const stepStrike = (dir: 1 | -1) => {
    if (strike == null) return;
    const i = strikeChoices.indexOf(strike);
    const next = strikeChoices[i + dir];
    if (next != null) setStrike(next);
  };

  return (
    <div className="page">
      <div className="toolbar">
        <SymbolSearch symbol={symbol} onSymbol={onSymbol} />
        <ExpirationSelect expirations={expirations} index={expIndex} onChange={setExpPick} />
        <Segmented label="Fill price" options={FILL_OPTIONS} value={fill} onChange={setFill} />
        <span className="toolbar-spacer" />
        <SessionPill info={sessionInfo} />
        <StatusPill status={status} />
        <RefreshButton onRefresh={refresh} busy={busy} lastUpdate={lastUpdate} now={now} />
      </div>

      <div className="strategy-picker" role="radiogroup" aria-label="Strategy">
        {STRATEGY_KEYS.map((k) => (
          <StrategyCard key={k} strategy={k} on={k === strategy} onClick={() => setStrategy(k)} />
        ))}
      </div>

      <ErrorBox error={chain.error ?? metrics.error} />

      {guide && spot && (
        <StrikeGuideCard
          guide={guide}
          active={appetite}
          onPick={(a, k) => {
            setAppetite(a);
            setStrike(k);
          }}
          selected={strike ?? undefined}
          rows={ladderData}
          seller={seller}
          type={def.type}
          spot={spot}
          vol={atmVol}
          dte={dte}
          plan={plan}
        />
      )}

      <div className="strategy-grid">
        <section className="card">
          <div className="card-head">
            <div className="card-title">
              <span className={`side-tag ${def.type}`}>{def.label}</span>
              {sel ? `${symbol} ${formatStrike(sel.strike)} ${def.type} · ${expDate ? formatDate(expDate) : ""} · ${dte}d` : "Profit and loss"}
            </div>
            <div className="card-actions">
              <PayoffLegend scenarioLabel={scenarioLabel} showScenario={scenario.daysForward < t * 365} guide={guideMark != null} />
              <Segmented label="Y axis" options={MODE_OPTIONS} value={mode} onChange={setMode} />
            </div>
          </div>
          {sel && spot ? (
            <PayoffChart
              legs={legs}
              spot={spot}
              vol={sel.iv}
              t={t}
              rate={RISK_FREE_RATE}
              scenario={scenario}
              scenarioLabel={scenarioLabel}
              mode={mode}
              capital={capital}
              breakevens={bes}
              guide={guideMark}
            />
          ) : (
            <div className="empty-block">
              {chain.isLoading ? "Loading chain…" : !spot ? "Waiting for the underlying price…" : `Waiting for a quote on the ${strike != null ? formatStrike(strike) : ""} ${def.type}…`}
            </div>
          )}
          <div className="whatif">
            <label className="slider">
              <span className="slider-label">
                Value in <b>{days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`}</b>
              </span>
              <input type="range" min={0} max={Math.max(0, dte - 1)} step={1} value={Math.min(days, Math.max(0, dte - 1))} onChange={(e) => setDays(Number(e.target.value))} />
            </label>
            <label className="slider">
              <span className="slider-label">
                IV change <b>{signedPct(ivShift, 0)}</b>
              </span>
              <input type="range" min={-0.5} max={1} step={0.05} value={ivShift} onChange={(e) => setIvShift(Number(e.target.value))} />
            </label>
            {(days !== 0 || ivShift !== 0) && (
              <button type="button" className="link-btn" onClick={() => (setDays(0), setIvShift(0))}>
                Reset
              </button>
            )}
            <span className="whatif-note">The dashed curve is the position priced with Black-Scholes at that date and IV.</span>
          </div>
        </section>

        <div className="side-col">
          <QuoteCard symbol={symbol} spot={underlying.spot} session={sessionInfo.session} loadingYahoo={underlying.yahooLoading} yahooError={underlying.yahooError} />
          <section className="card ticket">
            <div className="ticket-controls">
              <div className="stepper" aria-label="Strike">
                <span className="field-label">Strike</span>
                <button type="button" onClick={() => stepStrike(-1)} aria-label="Lower strike">
                  ‹
                </button>
                <select value={strike ?? ""} onChange={(e) => setStrike(Number(e.target.value))}>
                  {strikeChoices.map((k) => (
                    <option key={k} value={k}>
                      {formatStrike(k)}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => stepStrike(1)} aria-label="Higher strike">
                  ›
                </button>
              </div>
              <div className="stepper" aria-label="Contracts">
                <span className="field-label">Contracts</span>
                <button type="button" onClick={() => setContracts((c) => Math.max(1, c - 1))} aria-label="Fewer contracts">
                  −
                </button>
                <input type="number" min={1} max={999} value={contracts} onChange={(e) => setContracts(Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 1))))} />
                <button type="button" onClick={() => setContracts((c) => Math.min(999, c + 1))} aria-label="More contracts">
                  +
                </button>
              </div>
            </div>
            {sel && spot && ext ? (
              <>
                <div className="ticket-grid">
                  <TicketStat
                    label={seller ? "Credit received" : "Debit paid"}
                    value={usd(sel.premium * MULTIPLIER * contracts)}
                    sub={`${sel.premium.toFixed(2)} × ${MULTIPLIER}${contracts > 1 ? ` × ${contracts}` : ""} · ${selQuote?.theo ? "theoretical" : fill}`}
                  />
                  <TicketStat label="Breakeven" value={bes[0]?.toFixed(2) ?? "–"} sub={bes[0] ? `${signedPct(bes[0] / spot - 1)} from spot` : ""} />
                  <TicketStat label="Max profit" value={usd(ext.maxProfit * MULTIPLIER)} tone="up" />
                  <TicketStat label="Max loss" value={usd(ext.maxLoss * MULTIPLIER)} tone="down" />
                  <TicketStat label="Chance of profit" value={pct(sel.pop, 0)}>
                    <Meter value={sel.pop} />
                  </TicketStat>
                  {seller ? (
                    <TicketStat
                      label="Return if unchanged"
                      value={pct(sel.ret, 2)}
                      sub={`${sel.annualized != null ? `${pct(sel.annualized, 1)} a year · ` : ""}max ${pct(sel.maxRet ?? 0, 2)}`}
                    />
                  ) : (
                    <TicketStat label="Return at 1σ move" value={signedPct(sel.ret, 0)} sub={`stock at ${(def.type === "call" ? s1hi : s1lo).toFixed(2)}`} tone={sel.ret >= 0 ? "up" : "down"} />
                  )}
                  <TicketStat
                    label="Theta / day"
                    value={selQuote?.q.theta != null ? usd(def.dir * selQuote.q.theta * MULTIPLIER * contracts, true) : "–"}
                    sub={seller ? "time decay earned" : "time decay paid"}
                  />
                  <TicketStat
                    label="Delta"
                    value={sel.delta != null ? (def.dir * sel.delta * MULTIPLIER * contracts).toFixed(0) : "–"}
                    sub={`shares equivalent · IV ${pct(sel.iv, 1)}`}
                  />
                </div>
                <div className="card-foot">
                  Return is measured on {usd(capital)} of capital: {capitalPerShare?.label}.
                  {strategy === "short-call" ? " A naked short call needs margin instead and has unlimited risk." : ""}
                </div>
                {guideLevel && (
                  <div className="rx-note">
                    <GuideBadge />
                    {guideLevel.strike === sel.strike ? (
                      <span>
                        On the {APPETITE_LABEL[appetite].toLowerCase()} guide strike ({Math.round(guideLevel.delta * 100)}Δ).
                      </span>
                    ) : (
                      <span>
                        {APPETITE_LABEL[appetite]} guide is <b>{formatStrike(guideLevel.strike)}</b>; you picked {formatStrike(sel.strike)}.{" "}
                        <button type="button" className="rx-link" onClick={() => setStrike(guideLevel.strike)}>
                          Use {formatStrike(guideLevel.strike)}
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="empty-block small">Pick a strike once quotes arrive.</div>
            )}
          </section>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            How the strike changes the trade
            <span className="muted">
              {def.label.toLowerCase()} · {expDate ? `${formatDate(expDate)} (${dte}d)` : ""} · 1σ move ±{spot ? pct(sigmaMove[1], 1) : "–"}
            </span>
          </div>
          <div className="card-actions">
            <DataGuideLegend />
            <Segmented label="Ladder view" options={LADDER_VIEWS} value={ladderView} onChange={setLadderView} />
          </div>
        </div>
        {spot && ladderView === "chart" ? (
          <StrikeLadder
            rows={ladderData}
            spot={spot}
            selected={strike ?? undefined}
            onSelect={setStrike}
            seller={seller}
            sigmaMove={sigmaMove}
            targetLabel={`${signedPct(def.type === "call" ? sigmaMove[1] : sigmaMove[0])} (1σ ${def.type === "call" ? "up" : "down"})`}
            guide={ladderGuide}
          />
        ) : spot ? (
          <StrikeLadderTable rows={ladderData} selected={strike ?? undefined} onSelect={setStrike} seller={seller} guide={ladderGuide} />
        ) : (
          <div className="empty-block">Waiting for the underlying price…</div>
        )}
        <div className="card-foot">
          Probabilities assume a lognormal price with each strike's implied vol, so they include the volatility skew but not earnings or
          other jumps. Click a strike to load it above. {sessionInfo.session === "closed" ? "Market closed: premiums are from the last session. " : ""}
        </div>
      </section>
    </div>
  );
}

function StrategyCard({ strategy, on, onClick }: { strategy: Strategy; on: boolean; onClick: () => void }) {
  const d = STRATEGIES[strategy];
  return (
    <button type="button" role="radio" aria-checked={on} className={`strategy-card ${d.type} ${on ? "on" : ""}`} onClick={onClick}>
      <PayoffGlyph strategy={strategy} />
      <span className="sc-text">
        <span className="sc-label">{d.label}</span>
        <span className="sc-view">{d.view}</span>
      </span>
      <span className="sc-blurb">{d.blurb}</span>
    </button>
  );
}

/** Hockey-stick icon of the expiry payoff. */
function PayoffGlyph({ strategy }: { strategy: Strategy }) {
  const path = {
    "long-call": "M3 22 H26 L49 5",
    "short-call": "M3 10 H26 L49 27",
    "long-put": "M3 5 L26 22 H49",
    "short-put": "M3 27 L26 10 H49",
  }[strategy];
  return (
    <svg className="glyph" viewBox="0 0 52 32" aria-hidden>
      <line x1="2" x2="50" y1="16" y2="16" className="glyph-zero" />
      <path d={path} />
    </svg>
  );
}

function TicketStat({ label, value, sub, tone, children }: { label: string; value: string; sub?: string; tone?: "up" | "down"; children?: React.ReactNode }) {
  return (
    <div className="tstat">
      <div className="stat-label">{label}</div>
      <div className={`tstat-value ${tone ?? ""}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {children}
    </div>
  );
}
