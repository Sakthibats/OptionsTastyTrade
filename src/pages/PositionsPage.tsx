import { useState } from "react";
import { useAccounts, usePositions } from "../api/queries";
import { formatOcc, num } from "../analytics/metrics";
import type { Position } from "../api/types";
import { ErrorBox } from "../components/ErrorBox";
import { Field, Stat } from "../components/ui";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Unrealized P/L from tastytrade's close price vs average open. A daily mark, not live. */
function unrealized(p: Position): number | null {
  const close = num(p["close-price"]);
  const open = num(p["average-open-price"]);
  const qty = num(p.quantity);
  const mult = num(p.multiplier) ?? 1;
  if (close == null || open == null || qty == null) return null;
  const dir = p["quantity-direction"] === "Short" ? -1 : 1;
  return (close - open) * qty * mult * dir;
}

function dte(p: Position): number | null {
  if (!p["expires-at"]) return null;
  return Math.max(0, Math.ceil((Date.parse(p["expires-at"]) - Date.now()) / 86_400_000));
}

export function PositionsPage() {
  const accounts = useAccounts();
  const [selected, setSelected] = useState<string>();
  const accountNumber = selected ?? accounts.data?.[0]?.account["account-number"];
  const positions = usePositions(accountNumber);

  const list = positions.data ?? [];
  const pnl = list.reduce((sum, p) => sum + (unrealized(p) ?? 0), 0);
  const optionCount = list.filter((p) => p["instrument-type"].includes("Option")).length;
  const underlyings = new Set(list.map((p) => p["underlying-symbol"])).size;

  return (
    <div className="page">
      <div className="toolbar">
        <Field label="Account">
          <select value={accountNumber ?? ""} onChange={(e) => setSelected(e.target.value)}>
            {accounts.data?.map(({ account }) => (
              <option key={account["account-number"]} value={account["account-number"]}>
                {account.nickname || account["account-type-name"]} · {account["account-number"]}
              </option>
            ))}
          </select>
        </Field>
        <span className="toolbar-spacer" />
        {positions.isFetching && <span className="muted">Refreshing…</span>}
      </div>

      <div className="stats-row">
        <Stat label="Unrealized P/L" value={list.length ? usd.format(pnl) : undefined} sub={list.length ? (pnl >= 0 ? "▲ vs. last close" : "▼ vs. last close") : undefined} tone={pnl >= 0 ? "up" : "down"} />
        <Stat label="Positions" value={String(list.length)} />
        <Stat label="Option legs" value={String(optionCount)} />
        <Stat label="Underlyings" value={String(underlyings)} />
      </div>

      <ErrorBox error={accounts.error ?? positions.error} />

      <section className="card">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th className="left">Symbol</th>
                <th className="left">Type</th>
                <th>Qty</th>
                <th>DTE</th>
                <th>Avg open</th>
                <th>Close</th>
                <th>Unrealized</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const qty = (num(p.quantity) ?? 0) * (p["quantity-direction"] === "Short" ? -1 : 1);
                const u = unrealized(p);
                const d = dte(p);
                return (
                  <tr key={p.symbol}>
                    <td className="left sym" title={p.symbol}>
                      {formatOcc(p.symbol)}
                    </td>
                    <td className="left">
                      <span className={`type-badge ${p["instrument-type"].includes("Option") ? "option" : p["instrument-type"] === "Equity" ? "equity" : ""}`}>
                        {p["instrument-type"]}
                      </span>
                    </td>
                    <td className={qty < 0 ? "down" : ""}>{qty}</td>
                    <td>{d ?? "–"}</td>
                    <td>{num(p["average-open-price"])?.toFixed(2) ?? "–"}</td>
                    <td>{num(p["close-price"])?.toFixed(2) ?? "–"}</td>
                    <td>{u == null ? "–" : <span className={`pnl-chip ${u >= 0 ? "up" : "down"}`}>{usd.format(u)}</span>}</td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    {positions.isLoading || accounts.isLoading ? "Loading…" : "No positions."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
