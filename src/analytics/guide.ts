/**
 * Prescriptive strike guide: general rules of thumb for where to put the strike
 * of a one-leg trade, by risk appetite. Not advice; the page labels everything
 * produced here as "Guide" so it never reads as measured data.
 *
 * The rules are the common delta conventions (delta ≈ the market's odds of
 * finishing in the money):
 *   sellers: 16Δ (≈1σ out of the money), 30Δ (≈½σ), 40Δ (near the money)
 *   buyers:  70Δ (in the money, stock-like), 50Δ (at the money), 30Δ (out of the money)
 */
import { strikeForDelta, type OptionType } from "./blackScholes";
import { STRATEGIES, type Strategy } from "./payoff";

export type Appetite = "conservative" | "balanced" | "aggressive";
export const APPETITES: Appetite[] = ["conservative", "balanced", "aggressive"];
export const APPETITE_LABEL: Record<Appetite, string> = { conservative: "Conservative", balanced: "Balanced", aggressive: "Aggressive" };

interface LevelRule {
  delta: number;
  why: string;
}

const RULES: Record<"sell" | "buy", Record<Appetite, LevelRule>> = {
  sell: {
    conservative: { delta: 0.16, why: "About 1σ out, outside the expected move. Smaller credit, wins most often." },
    balanced: { delta: 0.3, why: "The classic premium-selling strike: a solid credit with room to be wrong." },
    aggressive: { delta: 0.4, why: "Close to the money. Biggest credit, but the stock barely has to move against you." },
  },
  buy: {
    conservative: { delta: 0.7, why: "In the money. Moves like the stock and loses less to time decay." },
    balanced: { delta: 0.5, why: "At the money. Full participation in the move at a moderate cost." },
    aggressive: { delta: 0.3, why: "Out of the money. Cheap leverage, but it needs a big move to pay." },
  },
};

export interface GuideLevel extends LevelRule {
  appetite: Appetite;
  /** Strike from the closed-form delta formula (one σ for all strikes, no skew). */
  formulaStrike: number;
  /** Listed strike chosen: closest chain delta to the target (skew-aware), else closest to the formula. */
  strike: number;
  chainDelta?: number;
  /** Distance of the strike from spot in σ units: ln(K/S) / (σ√t). */
  sigmas: number;
}

export interface GuideCheck {
  /** true = fits the rule, false = goes against it, null = something to check yourself. */
  ok: boolean | null;
  title: string;
  text: string;
}

export interface Guide {
  levels: GuideLevel[];
  /** Strike range spanned by the three appetites. */
  zone: [number, number];
  /** 1σ move in dollars: S·σ·√t. */
  expectedMove: number;
  checks: GuideCheck[];
}

export interface GuideInput {
  spot: number;
  vol: number;
  t: number;
  dte: number;
  rate: number;
  /** 0..1, tastytrade IV index rank. */
  ivRank?: number;
  chain: Array<{ strike: number; delta?: number }>;
}

export function expectedMove(spot: number, vol: number, t: number): number {
  return spot * vol * Math.sqrt(Math.max(0, t));
}

export function strikeGuide(strategy: Strategy, input: GuideInput): Guide | null {
  const { spot, vol, t, dte, rate, ivRank, chain } = input;
  if (!chain.length || !(spot > 0) || !(vol > 0)) return null;
  const def = STRATEGIES[strategy];
  const side = def.dir < 0 ? "sell" : "buy";
  const sigT = vol * Math.sqrt(Math.max(t, 1 / 365 / 24));

  const levels = APPETITES.map((appetite) => {
    const rule = RULES[side][appetite];
    const formulaStrike = strikeForDelta(def.type, rule.delta, spot, vol, t, rate);
    const pick = pickStrike(chain, def.type, rule.delta, formulaStrike);
    return { appetite, ...rule, formulaStrike, strike: pick.strike, chainDelta: pick.delta, sigmas: Math.log(pick.strike / spot) / sigT };
  });
  const ks = levels.map((l) => l.strike);
  return {
    levels,
    zone: [Math.min(...ks), Math.max(...ks)],
    expectedMove: expectedMove(spot, vol, t),
    checks: contextChecks(strategy, dte, ivRank),
  };
}

function pickStrike(chain: GuideInput["chain"], type: OptionType, target: number, formulaStrike: number): { strike: number; delta?: number } {
  const withDelta = chain.filter((c) => c.delta != null && Number.isFinite(c.delta));
  // Use chain deltas only if they bracket the target; otherwise the nearest one could be far off.
  const abs = withDelta.map((c) => Math.abs(c.delta!));
  if (withDelta.length >= 3 && Math.min(...abs) <= target && Math.max(...abs) >= target) {
    let best = withDelta[0]!;
    for (const c of withDelta) if (Math.abs(Math.abs(c.delta!) - target) < Math.abs(Math.abs(best.delta!) - target)) best = c;
    return { strike: best.strike, delta: best.delta };
  }
  let best = chain[0]!;
  for (const c of chain) if (Math.abs(c.strike - formulaStrike) < Math.abs(best.strike - formulaStrike)) best = c;
  void type;
  return { strike: best.strike, delta: best.delta };
}

/** Rule-of-thumb checks on the setup itself (volatility regime, time to expiration). */
export function contextChecks(strategy: Strategy, dte: number, ivRank?: number): GuideCheck[] {
  const seller = STRATEGIES[strategy].dir < 0;
  const out: GuideCheck[] = [];

  if (ivRank != null) {
    const r = `IV rank ${Math.round(ivRank * 100)}%`;
    if (seller)
      out.push(
        ivRank >= 0.3
          ? { ok: true, title: r, text: "Options are pricey versus the past year, which favors selling premium." }
          : { ok: false, title: r, text: "Options are cheap versus the past year: selling pays little for the risk. Rule of thumb: sell above ~30." },
      );
    else
      out.push(
        ivRank <= 0.3
          ? { ok: true, title: r, text: "Options are cheap versus the past year, which favors buying." }
          : { ok: false, title: r, text: "Options are pricey: a drop in IV can hurt even if you're right on direction. Rule of thumb: buy below ~30." },
      );
  }

  const d = `${dte} days to expiration`;
  if (seller) {
    if (dte < 21) out.push({ ok: false, title: d, text: "Inside 21 days, small moves swing the P/L hard (gamma risk). Sellers usually open at 30–45 days." });
    else if (dte <= 60) out.push({ ok: true, title: d, text: "In the 30–45 day sweet spot (±): decay is quick and there's time to manage." });
    else out.push({ ok: null, title: d, text: "Long-dated: more credit, but it decays slowly. Sellers usually open at 30–45 days." });
  } else {
    if (dte < 30) out.push({ ok: false, title: d, text: "Time decay is fastest in the last 30 days. Buyers usually give a trade 60+ days." });
    else if (dte < 60) out.push({ ok: null, title: d, text: "Workable, but buyers usually give a trade 60+ days so decay is slower." });
    else out.push({ ok: true, title: d, text: "Enough time for the move to happen before decay speeds up." });
  }

  if (strategy === "short-call") out.push({ ok: null, title: "Covered?", text: "These levels assume you own 100 shares per contract. Uncovered, the risk is unlimited." });
  out.push({ ok: null, title: "Events", text: "Check for earnings or other news before expiration. These rules assume none." });
  return out;
}

export interface PlanItem {
  label: string;
  rule: string;
  value: string;
}

/**
 * Common exit rules for the selected trade, in dollars. Sellers: take profit at
 * 50% of the credit, stop at a loss of 2× the credit, manage at 21 days left.
 * Buyers: take profit at +50%, stop at −50%, don't hold into the last 30 days.
 */
export function managementPlan(strategy: Strategy, premium: number, contracts: number, multiplier: number, dte: number, expiration?: string): PlanItem[] {
  const seller = STRATEGIES[strategy].dir < 0;
  const total = premium * multiplier * contracts;
  const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
  const dateAt = (daysLeft: number) => {
    if (!expiration || dte <= daysLeft) return "now";
    const d = new Date(`${expiration}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - daysLeft);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  if (seller) {
    return [
      { label: "Take profit", rule: "at 50% of the credit", value: `buy back at ${(premium * 0.5).toFixed(2)} · +${money(total * 0.5)}` },
      { label: "Stop", rule: "at a loss of 2× the credit", value: `buy back at ${(premium * 3).toFixed(2)} · −${money(total * 2)}` },
      { label: "Time", rule: "close or roll at 21 days left", value: dateAt(21) },
    ];
  }
  return [
    { label: "Take profit", rule: "at +50%", value: `sell at ${(premium * 1.5).toFixed(2)} · +${money(total * 0.5)}` },
    { label: "Stop", rule: "at −50%", value: `sell at ${(premium * 0.5).toFixed(2)} · −${money(total * 0.5)}` },
    { label: "Time", rule: "exit with 30 days left", value: dateAt(30) },
  ];
}
