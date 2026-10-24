// Douglas–Peucker in metres, then rounding, so geometry stays within the size budget.

import type { LonLat } from "../../src/schema";
import type { Scope } from "../config";
import { projectOnto } from "./geo";

/**
 * How far geometry may move, in metres, and how many decimals coordinates keep, per scope.
 * `coarse` is what network.json carries, for the overview and the first paint; the detail file
 * adds `fine` geometry, finest for rail (`major`) and a little coarser for buses (`minor`).
 */
export const PRECISION: Record<Scope, { coarse: number; fine: { major: number; minor: number }; decimals: number }> = {
  city: { coarse: 15, fine: { major: 1, minor: 5 }, decimals: 5 },
  region: { coarse: 15, fine: { major: 1, minor: 5 }, decimals: 5 },
  country: { coarse: 500, fine: { major: 100, minor: 200 }, decimals: 4 },
  continent: { coarse: 2000, fine: { major: 500, minor: 1000 }, decimals: 3 },
  world: { coarse: 2000, fine: { major: 500, minor: 1000 }, decimals: 3 },
};

/** Drops points that lie within `tolerance` metres of the line through their neighbours. Ends always stay. */
export function simplify(pts: LonLat[], tolerance: number): LonLat[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1, max = tolerance;
    for (let i = a + 1; i < b; i++) {
      const { d } = projectOnto(pts[i], pts[a], pts[b]);
      if (d > max) { max = d; far = i; }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([a, far], [far, b]);
  }
  return pts.filter((_, i) => keep[i]);
}

export const round = (v: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f || 0;   // || 0 turns -0 into 0
};

export const roundPoint = (p: LonLat, decimals: number): LonLat => [round(p[0], decimals), round(p[1], decimals)];

/** Simplified and rounded, without the repeated points rounding can leave behind. */
export function tidy(pts: LonLat[], tolerance: number, decimals: number): LonLat[] {
  const out = simplify(pts, tolerance).map((p) => roundPoint(p, decimals));
  return out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
}
