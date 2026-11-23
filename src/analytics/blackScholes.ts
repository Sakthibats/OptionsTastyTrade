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
