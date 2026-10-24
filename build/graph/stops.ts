// Many OSM objects describe one station: stop positions per track, platforms, a station node.
// They become one stop when they share a stop_area relation, or carry the same name within ~300 m.

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

export function dedupeStops(cands: StopCandidate[], radius = 300): Deduped {
  const parent = cands.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };

  const firstInArea = new Map<string, number>();
  const byName = new Map<string, number[]>();
  cands.forEach((c, i) => {
    if (c.area) {
      const j = firstInArea.get(c.area.id);
      if (j == null) firstInArea.set(c.area.id, i);
      else union(i, j);
    }
    const n = norm(c.name ?? c.area?.name);
    if (n) byName.set(n, [...(byName.get(n) ?? []), i]);
  });
  for (const idx of byName.values()) {
    for (let x = 0; x < idx.length; x++) {
      for (let y = x + 1; y < idx.length; y++) {
        if (metres(cands[idx[x]].geo, cands[idx[y]].geo) <= radius) union(idx[x], idx[y]);
      }
    }
  }

  const clusters = new Map<number, StopCandidate[]>();
  cands.forEach((c, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), c]));

  const stops: GraphStop[] = [];
  const stopOf = new Map<string, string>();
  for (const members of clusters.values()) {
    members.sort((a, b) => compareIds(a.id, b.id));
    const areas = [...new Map(members.filter((m) => m.area).map((m) => [m.area!.id, m.area!])).values()]
      .sort((a, b) => compareIds(a.id, b.id));
    const stations = members.filter((m) => m.station);
    const stop: GraphStop = {
      id: areas[0]?.id ?? members[0].id,
      name: areas.find((a) => a.name)?.name ?? commonest(members.map((m) => m.name)) ?? "",
      geo: stations.length ? stations[0].geo : mean(members.map((m) => m.geo)),
      members: members.map((m) => m.id),
      wikidata: (stations.find((m) => m.wikidata) ?? members.find((m) => m.wikidata))?.wikidata,
    };
    if (!stop.wikidata) delete stop.wikidata;
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
