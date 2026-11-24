/**
 * Black-Scholes-Merton pricing, greeks and implied volatility (European, with
 * continuous dividend yield q). Pure functions, no dependencies, so they run in
 * the browser, a Web Worker, or the Cloudflare Worker alike.
 *
 * Units: t in years, rates/vol as decimals (0.05 = 5%).
 * theta is per calendar day, vega and rho per 1 percentage point.
 */

export type OptionType = "call" | "put";

export interface BsInput {
  type: OptionType;
  spot: number;
  strike: number;
  t: number;
  vol: number;
  rate: number;
  divYield?: number;
}

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Standard normal CDF via erfc. */
export function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

function erfc(x: number): number {
  // Numerical Recipes erfc with Chebyshev fit; relative error < 1.2e-7 everywhere,
  // which is far below option-pricing tick sizes.
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

function d1d2({ spot, strike, t, vol, rate, divYield = 0 }: BsInput): [number, number] {
  const vsqrt = vol * Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (rate - divYield + 0.5 * vol * vol) * t) / vsqrt;
  return [d1, d1 - vsqrt];
}

export function price(input: BsInput): number {
  const { type, spot, strike, t, vol, rate, divYield = 0 } = input;
  if (t <= 0 || vol <= 0) return intrinsic(type, spot, strike);
  const [d1, d2] = d1d2(input);
  const dfq = Math.exp(-divYield * t);
  const dfr = Math.exp(-rate * t);
  return type === "call"
    ? spot * dfq * normCdf(d1) - strike * dfr * normCdf(d2)
    : strike * dfr * normCdf(-d2) - spot * dfq * normCdf(-d1);
}

export function greeks(input: BsInput): Greeks {
  const { type, spot, strike, t, vol, rate, divYield = 0 } = input;
  if (t <= 0 || vol <= 0) {
    const itm = type === "call" ? spot > strike : spot < strike;
    return { price: intrinsic(type, spot, strike), delta: itm ? (type === "call" ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const [d1, d2] = d1d2(input);
  const sqrtT = Math.sqrt(t);
  const dfq = Math.exp(-divYield * t);
  const dfr = Math.exp(-rate * t);
  const pdf1 = normPdf(d1);

  const gamma = (dfq * pdf1) / (spot * vol * sqrtT);
  const vega = (spot * dfq * pdf1 * sqrtT) / 100;
  const common = -(spot * dfq * pdf1 * vol) / (2 * sqrtT);

  if (type === "call") {
    return {
      price: price(input),
      delta: dfq * normCdf(d1),
      gamma,
      theta: (common - rate * strike * dfr * normCdf(d2) + divYield * spot * dfq * normCdf(d1)) / 365,
      vega,
      rho: (strike * t * dfr * normCdf(d2)) / 100,
    };
  }
  return {
    price: price(input),
    delta: -dfq * normCdf(-d1),
    gamma,
    theta: (common + rate * strike * dfr * normCdf(-d2) - divYield * spot * dfq * normCdf(-d1)) / 365,
    vega,
    rho: (-strike * t * dfr * normCdf(-d2)) / 100,
  };
}

/** Implied vol by bisection-safeguarded Newton. Returns NaN if no solution in (0, 5]. */
export function impliedVol(target: number, input: Omit<BsInput, "vol">, tol = 1e-6): number {
  const lowerBound = intrinsic(input.type, input.spot * Math.exp(-(input.divYield ?? 0) * input.t), input.strike * Math.exp(-input.rate * input.t));
  if (!(target > lowerBound) || input.t <= 0) return NaN;

  let lo = 1e-6;
  let hi = 5;
  let vol = 0.3;
  for (let i = 0; i < 100; i++) {
    const p = price({ ...input, vol });
    const diff = p - target;
    if (Math.abs(diff) < tol) return vol;
    if (diff > 0) hi = vol;
    else lo = vol;
    const v = greeks({ ...input, vol }).vega * 100;
    const next = v > 1e-8 ? vol - diff / v : NaN;
    vol = next > lo && next < hi ? next : (lo + hi) / 2;
  }
  return hi - lo < 1e-4 ? vol : NaN;
}

export function intrinsic(type: OptionType, spot: number, strike: number): number {
  return Math.max(0, type === "call" ? spot - strike : strike - spot);
}

/** Year fraction from now to an expiration date (tastytrade "YYYY-MM-DD"), assuming 4pm ET close. */
export function yearsToExpiry(expirationDate: string, now = new Date()): number {
  const expiry = new Date(`${expirationDate}T21:00:00Z`); // 16:00 ET (EST); ±1h in DST is noise here
  return Math.max(0, (expiry.getTime() - now.getTime()) / (365 * 24 * 3600 * 1000));
}

/** Rate used when the app prices options itself (estimates, what-if curves). */
export const RISK_FREE_RATE = 0.045;

/** Inverse standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9). */
export function normInv(p: number): number {
  if (!(p > 0)) return -Infinity;
  if (!(p < 1)) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q: number) => (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/**
 * Strike whose Black-Scholes delta equals `absDelta` (0..1, sign ignored).
 * Inverts delta = N(d1) for calls and N(d1) − 1 for puts:
 *   K = S · exp(−d1·σ√t + (r + σ²/2)·t),  d1 = N⁻¹(Δ) for calls, N⁻¹(1 − |Δ|) for puts.
 */
export function strikeForDelta(type: OptionType, absDelta: number, spot: number, vol: number, t: number, rate: number): number {
  const d1 = normInv(type === "call" ? absDelta : 1 - absDelta);
  const tt = Math.max(t, 1 / 365 / 24);
  return spot * Math.exp(-d1 * vol * Math.sqrt(tt) + (rate + 0.5 * vol * vol) * tt);
}
