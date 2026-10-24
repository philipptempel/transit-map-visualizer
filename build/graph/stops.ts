// Many OSM objects describe one station: stop positions per track, platforms, a station node.
// They become one stop when they share a stop_area relation, or carry the same name within ~300 m,
// and their tracks run the same way: platforms on crossing streets are two stops, even if OSM
// gives them one name and one stop area.

import type { LonLat, Stop } from "../../src/schema";
import { compareIds, type StopCandidate } from "../sources/osm";
import { metres } from "./geo";

export interface GraphStop extends Stop {
  members: string[];   // candidate ids merged into this stop
  wikidata?: string;   // for joining dates in later phases; not written out
}

export interface Deduped {
  stops: GraphStop[];
  stopOf: Map<string, string>;   // candidate id → stop id
}

const norm = (s?: string) => s?.trim().toLowerCase().replace(/\s+/g, " ");

/** Track directions within this many degrees of each other run the same way. */
export const SAME_AXIS = 35;
/** Platforms this close are one stop whichever way their tracks run (platforms stacked or side by side). */
export const SAME_SPOT = 30;

/** The mean of axes (0–180°), on the doubled circle so that 175° and 5° average to 0°. */
function meanAxis(a: number[]): number {
  const x = a.reduce((t, v) => t + Math.cos((2 * v * Math.PI) / 180), 0), y = a.reduce((t, v) => t + Math.sin((2 * v * Math.PI) / 180), 0);
  return ((((Math.atan2(y, x) * 180) / Math.PI / 2) % 180) + 180) % 180;
}
const axisGap = (a: number, b: number) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };

/** What serves a candidate: the lines that stop there and the groups (tram, bus, ...) they belong to. */
export interface Served { lines: Set<string>; groups: Set<string> }

const meets = <T>(a: Set<T> | undefined, b: Set<T> | undefined) => !!a && !!b && [...a].some((x) => b.has(x));

/**
 * `axes` gives the direction of the track at each candidate (see stopAxes); candidates without one
 * join whichever stop they are nearest to, but never join two that run different ways.
 *
 * Two platforms whose tracks cross more than 30 m apart stay apart, unless a line stops at both
 * (its two directions on staggered platforms, or on a curve). Where a line links two clusters,
 * only platforms of the same group keep them apart: the bus stop beside a station does not, but
 * two Stadtbahn platforms on crossing streets, with no line in common, still do.
 */
export function dedupeStops(cands: StopCandidate[], radius = 300, axes = new Map<string, number[]>(), served = new Map<string, Served>()): Deduped {
  const parent = cands.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const axis = cands.map((c) => (axes.get(c.id)?.length ? meanAxis(axes.get(c.id)!) : null));
  const by = cands.map((c) => served.get(c.id));
  const members = cands.map((_, i) => [i]);   // per cluster root
  const shareLine = (i: number, j: number) => meets(by[i]?.lines, by[j]?.lines);
  const fits = (ra: number, rb: number) => {
    const linked = members[ra].some((i) => members[rb].some((j) => shareLine(i, j)));
    return members[ra].every((i) => members[rb].every((j) =>
      axis[i] == null || axis[j] == null ||
      axisGap(axis[i]!, axis[j]!) <= SAME_AXIS || metres(cands[i].geo, cands[j].geo) <= SAME_SPOT ||
      shareLine(i, j) || (linked && !meets(by[i]?.groups, by[j]?.groups))));
  };

  // Pairs that might be one stop: same stop area, or same name within `radius`. Closest first.
  const pairs: [d: number, a: number, b: number][] = [];
  const byArea = new Map<string, number[]>(), byName = new Map<string, number[]>();
  cands.forEach((c, i) => {
    if (c.area) byArea.set(c.area.id, [...(byArea.get(c.area.id) ?? []), i]);
    const n = norm(c.name ?? c.area?.name);
    if (n) byName.set(n, [...(byName.get(n) ?? []), i]);
  });
  const seen = new Set<string>();
  for (const [idx, near] of [...[...byArea.values()].map((v) => [v, Infinity] as const), ...[...byName.values()].map((v) => [v, radius] as const)]) {
    for (let x = 0; x < idx.length; x++) {
      for (let y = x + 1; y < idx.length; y++) {
        const d = metres(cands[idx[x]].geo, cands[idx[y]].geo), k = `${idx[x]} ${idx[y]}`;
        if (d <= near && !seen.has(k)) { seen.add(k); pairs.push([d, idx[x], idx[y]]); }
      }
    }
  }
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  for (const [, a, b] of pairs) {
    const ra = find(a), rb = find(b);
    if (ra === rb || !fits(ra, rb)) continue;
    parent[ra] = rb;
    members[rb].push(...members[ra]);
  }

  const clusters = new Map<number, StopCandidate[]>();
  cands.forEach((c, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), c]));

  const stops: GraphStop[] = [];
  const stopOf = new Map<string, string>();
  const taken = new Set<string>();   // a stop area split in two gives its id to one part only
  const ordered = [...clusters.values()].map((m) => m.sort((a, b) => compareIds(a.id, b.id)))
    .sort((a, b) => compareIds(a[0].id, b[0].id));
  for (const members of ordered) {
    const areas = [...new Map(members.filter((m) => m.area).map((m) => [m.area!.id, m.area!])).values()]
      .sort((a, b) => compareIds(a.id, b.id));
    const stations = members.filter((m) => m.station);
    const stop: GraphStop = {
      id: areas.find((a) => !taken.has(a.id))?.id ?? members[0].id,
      name: areas.find((a) => a.name)?.name ?? commonest(members.map((m) => m.name)) ?? "",
      geo: stations.length ? stations[0].geo : mean(members.map((m) => m.geo)),
      members: members.map((m) => m.id),
      wikidata: (stations.find((m) => m.wikidata) ?? members.find((m) => m.wikidata))?.wikidata,
    };
    if (!stop.wikidata) delete stop.wikidata;
    taken.add(stop.id);
    stops.push(stop);
    for (const m of members) stopOf.set(m.id, stop.id);
  }
  stops.sort((a, b) => compareIds(a.id, b.id));
  return { stops, stopOf };
}

function mean(pts: LonLat[]): LonLat {
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/** The most frequent name; ties go to the alphabetically first. */
function commonest(names: (string | undefined)[]): string | undefined {
  const count = new Map<string, number>();
  for (const n of names) if (n) count.set(n, (count.get(n) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}
