// One point per stop, on the track, where all its segments meet. Each route's track starts where
// that route stops, so at a big station the segments' ends lie on platforms up to ~100 m apart,
// and the stop itself (often the station building) may be off the track altogether. The map does
// not need that precision; it needs the lines to meet at the stop.

import type { LonLat, Mode, Segment } from "../../src/schema";
import { metres } from "./geo";

/**
 * Where each stop goes: the most central of its segments' track ends, taken from its most
 * prominent mode (lowest `rank`; rail before buses), so a bus stop round the corner does not pull
 * a station off its tracks. Stops whose segments have no geometry are left out.
 */
export function anchorStops(segments: Segment[], rank: (m: Mode) => number): Map<string, LonLat> {
  const ends = new Map<string, { rank: number; pts: LonLat[] }>();
  const add = (stop: string, r: number, p: LonLat) => {
    const e = ends.get(stop);
    if (!e || r < e.rank) ends.set(stop, { rank: r, pts: [p] });
    else if (r === e.rank) e.pts.push(p);
  };
  for (const s of segments) {
    if (!s.geo || s.geo.length < 2) continue;
    add(s.from, rank(s.mode), s.geo[0]);
    add(s.to, rank(s.mode), s.geo[s.geo.length - 1]);
  }
  const out = new Map<string, LonLat>();
  for (const [stop, { pts }] of ends) {
    let best = pts[0], least = Infinity;
    for (const p of pts) {
      const sum = pts.reduce((t, q) => t + metres(p, q), 0);
      if (sum < least) { least = sum; best = p; }
    }
    out.set(stop, best);
  }
  return out;
}

/** Track points this close to a stop go: platforms are straight, and kinks there show up as steps. */
export const STATION = 25;

/**
 * Moves the ends of a track to the stops' points. Track points nearer to the new end than the old
 * end was lie in the station, behind the new end; they go, so the line does not double back, and
 * so do the points within `STATION` metres of it, whose small bends become steps in a bundle.
 */
export function snapEnds(geo: LonLat[], from: LonLat, to: LonLat): LonLat[] {
  const trim = (pts: LonLat[], anchor: LonLat): LonLat[] => {
    const r = Math.max(metres(pts[0], anchor), STATION);
    let i = 1;
    while (i < pts.length - 1 && metres(pts[i], anchor) <= r) i++;
    return [anchor, ...pts.slice(i)];
  };
  return trim([...trim(geo, from)].reverse(), to).reverse();
}
