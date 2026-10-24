// Routes become segments: each pair of consecutive stops, with the stretch of track between them.
// Segments that several routes share are merged, and list every line that runs on them.

import type { LonLat, Mode, Segment } from "../../src/schema";
import { lerp, projectOnto } from "./geo";

const same = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];

/** Joins way geometries into as few polylines as possible, flipping ways to meet end to end. */
export function joinWays(ways: LonLat[][]): LonLat[][] {
  const out: LonLat[][] = [];
  let cur: LonLat[] | null = null;
  let single = false;   // cur is still one way, so it may be flipped to fit the next
  for (const w of ways) {
    if (!cur) { cur = [...w]; single = true; continue; }
    const end = cur.at(-1)!;
    if (single && !same(end, w[0]) && !same(end, w.at(-1)!) && (same(cur[0], w[0]) || same(cur[0], w.at(-1)!))) {
      cur.reverse();
    }
    const tail = cur.at(-1)!;
    if (same(tail, w[0])) cur.push(...w.slice(1));
    else if (same(tail, w.at(-1)!)) cur.push(...[...w].reverse().slice(1));
    else { out.push(cur); cur = [...w]; single = true; continue; }
    single = false;
  }
  if (cur) out.push(cur);
  return out;
}

interface At { i: number; t: number; d: number }   // on segment i of the line, fraction t, d metres away

/** The closest point on `line` to `p`, at or after `from`. */
function locate(line: LonLat[], p: LonLat, from: At): At {
  let best: At = { i: from.i, t: from.t, d: Infinity };
  for (let i = from.i; i < line.length - 1; i++) {
    const { t, d } = projectOnto(p, line[i], line[i + 1]);
    if (i === from.i && t < from.t) continue;
    if (d < best.d) best = { i, t, d };
  }
  return best;
}

const pointAt = (line: LonLat[], a: At) => lerp(line[a.i], line[a.i + 1], a.t);

/** The track from a to b. A stop that sits exactly on a vertex would otherwise put that point in twice. */
function slice(line: LonLat[], a: At, b: At): LonLat[] {
  const pts = [pointAt(line, a), ...line.slice(a.i + 1, b.i + 1), pointAt(line, b)];
  return pts.filter((p, k) => k === 0 || !same(p, pts[k - 1]));
}

export interface RouteForGraph {
  line: string;                                   // id of the Line this route belongs to
  mode: Mode;
  stops: { stop: string; geo: LonLat }[];         // in travel order; geo is where this route stops
  path: LonLat[][];                               // way geometries in member order
}

/**
 * Segments from routes, in the order given. A segment points the way the first route through it
 * runs; later routes add their line to it. Geometry is cut from the track when both stops lie
 * within `snap` metres of it, otherwise the segment is left straight.
 */
export function buildSegments(routes: RouteForGraph[], snap = 150): Segment[] {
  const byKey = new Map<string, Segment>();
  for (const r of routes) {
    const stops = r.stops.filter((s, i) => i === 0 || s.stop !== r.stops[i - 1].stop);
    const line = joinWays(r.path).flat().filter((p, i, all) => i === 0 || !same(p, all[i - 1]));
    let at: At = { i: 0, t: 0, d: 0 };
    let prev: At | null = null;
    for (let k = 0; k < stops.length; k++) {
      const here = line.length > 1 ? locate(line, stops[k].geo, at) : null;
      const onTrack = !!here && here.d <= snap;
      if (onTrack) at = here;
      if (k > 0) {
        const a = stops[k - 1].stop, b = stops[k].stop;
        const geo = prev && onTrack ? slice(line, prev, here!) : undefined;
        const key = `${r.mode}|${[a, b].sort().join("|")}`;
        const seg = byKey.get(key);
        if (!seg) byKey.set(key, { from: a, to: b, mode: r.mode, lines: [r.line], ...(geo && { geo }) });
        else {
          if (!seg.lines!.includes(r.line)) seg.lines = [...(seg.lines as string[]), r.line].sort();
          if (!seg.geo && geo) seg.geo = seg.from === a ? geo : [...geo].reverse();
        }
      }
      prev = onTrack ? here : null;
    }
  }
  return [...byKey.values()];
}

/** Track direction as an angle in degrees, 0 to 180: which way a track runs, not which way it is driven. */
export function axis(a: LonLat, b: LonLat): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  const deg = (Math.atan2(b[1] - a[1], (b[0] - a[0]) * k) * 180) / Math.PI;
  return ((deg % 180) + 180) % 180;
}

/**
 * The direction of the track at each stop candidate, from every route that stops there (within
 * `snap` metres of its track). Two platforms with one name but tracks at right angles are two
 * places, such as the north–south and east–west platforms of an interchange.
 */
export function stopAxes(routes: { stops: { id: string; geo: LonLat }[]; path: LonLat[][] }[], snap = 150): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of routes) {
    const line = joinWays(r.path).flat().filter((p, i, all) => i === 0 || !same(p, all[i - 1]));
    if (line.length < 2) continue;
    let at: At = { i: 0, t: 0, d: 0 };
    for (const s of r.stops) {
      const here = locate(line, s.geo, at);
      if (here.d > snap) continue;
      at = here;
      out.set(s.id, [...(out.get(s.id) ?? []), axis(line[here.i], line[here.i + 1])]);
    }
  }
  return out;
}
