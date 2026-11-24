import type { Session, Spot } from "../analytics/market";
import { pct } from "../analytics/metrics";
import { Flash, RangeBar } from "./ui";

export function QuoteCard({ symbol, spot, session, loadingYahoo, yahooError }: { symbol: string; spot: Spot; session: Session; loadingYahoo: boolean; yahooError: boolean }) {
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
