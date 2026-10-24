// Douglas–Peucker in metres, then rounding, so geometry stays within the size budget.

import type { LonLat } from "../../src/schema";
import type { Scope } from "../config";
import { projectOnto } from "./geo";

/** How far geometry may move, and how many decimals coordinates keep, per scope. */
export const PRECISION: Record<Scope, { tolerance: number; decimals: number }> = {
  city: { tolerance: 5, decimals: 5 },
  region: { tolerance: 5, decimals: 5 },
  country: { tolerance: 200, decimals: 3 },
  continent: { tolerance: 1000, decimals: 3 },
  world: { tolerance: 1000, decimals: 3 },
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
