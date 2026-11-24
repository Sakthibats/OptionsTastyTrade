/** Tiny SVG chart helpers (no chart library: keeps the bundle small and the marks exact). */

export interface Scale {
  (v: number): number;
  invert: (px: number) => number;
}

export function linear([d0, d1]: [number, number], [r0, r1]: [number, number]): Scale {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = ((v: number) => r0 + (v - d0) * k) as Scale;
  f.invert = (px: number) => (k === 0 ? d0 : d0 + (px - r0) / k);
  return f;
}

/** Round tick values covering [min, max], about `count` of them (1-2-5 steps). */
export function niceTicks(min: number, max: number, count = 6): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export function pathOf(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
}

/** Pad a [min, max] extent by a fraction of its span (and make sure it isn't empty). */
export function padExtent(min: number, max: number, frac = 0.08): [number, number] {
  const span = max - min || Math.abs(max) || 1;
  return [min - span * frac, max + span * frac];
}
