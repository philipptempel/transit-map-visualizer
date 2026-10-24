// The OSM JSON that Overpass returns (OpenHistoricalMap uses the same format), turned into
// route records and stop candidates. No network here; overpass.ts does the fetching.

import type { LonLat } from "../../src/schema";
import type { RouteInfo } from "../classify";

export type Tags = Record<string, string>;
interface LatLon { lat: number; lon: number }

export interface OsmNode { type: "node"; id: number; lat: number; lon: number; tags?: Tags }
export interface OsmWay { type: "way"; id: number; nodes?: number[]; geometry?: LatLon[]; tags?: Tags }
export interface OsmMember { type: "node" | "way" | "relation"; ref: number; role: string }
export interface OsmRelation { type: "relation"; id: number; members: OsmMember[]; tags?: Tags }
export type OsmElement = OsmNode | OsmWay | OsmRelation;
export interface OsmResponse { elements: OsmElement[] }

/** "n123", "w45", "r6": unique across element types. */
export const osmId = (type: OsmElement["type"], id: number) => `${type[0]}${id}`;

export class OsmIndex {
  readonly nodes = new Map<number, OsmNode>();
  readonly ways = new Map<number, OsmWay>();
  readonly relations = new Map<number, OsmRelation>();

  constructor(elements: Iterable<OsmElement>) {
    for (const e of elements) {
      if (e.type === "node") this.nodes.set(e.id, e);
      else if (e.type === "way") this.ways.set(e.id, e);
      else this.relations.set(e.id, e);
    }
  }

  /** A way's coordinates, from inline geometry (out geom) or its node list (out body + >). */
  wayCoords(id: number): LonLat[] | undefined {
    const w = this.ways.get(id);
    if (!w) return undefined;
    if (w.geometry) return w.geometry.map((p): LonLat => [p.lon, p.lat]);
    const pts = (w.nodes ?? []).map((n) => this.nodes.get(n));
    return pts.every((p) => p) ? pts.map((p): LonLat => [p!.lon, p!.lat]) : undefined;
  }

  /** Where a node or way member sits: the node itself, or the mean of a way's points (a platform drawn as a line). */
  position(m: OsmMember): LonLat | undefined {
    if (m.type === "node") {
      const n = this.nodes.get(m.ref);
      return n && [n.lon, n.lat];
    }
    if (m.type !== "way") return undefined;
    const pts = this.wayCoords(m.ref);
    if (!pts?.length) return undefined;
    const ring = pts.length > 1 && pts[0][0] === pts.at(-1)![0] && pts[0][1] === pts.at(-1)![1] ? pts.slice(1) : pts;
    return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  }

  tags(m: OsmMember): Tags {
    const e = m.type === "node" ? this.nodes.get(m.ref) : m.type === "way" ? this.ways.get(m.ref) : this.relations.get(m.ref);
    return e?.tags ?? {};
  }
}

const ROLE = /^(?:forward:|backward:)?(stop|platform)(?:_entry_only|_exit_only)?$/;
const role = (r: string) => r.match(ROLE)?.[1] as "stop" | "platform" | undefined;
const isStation = (t: Tags) => t.public_transport === "station" || t.railway === "station" || t.railway === "halt";

export interface RouteRecord {
  id: string;                    // "r123"
  master?: string;               // its route_master, if any
  info: RouteInfo;               // what classify() looks at
  tags: Tags;
  masterTags?: Tags;
  stops: string[];               // stop candidate ids in travel order
  path: LonLat[][];              // way geometries in member order, not yet joined
}

export interface StopCandidate {
  id: string;                    // "n123" or "w45"
  name?: string;
  geo: LonLat;
  area?: { id: string; name?: string };   // the stop_area relation it belongs to
  station?: boolean;
  wikidata?: string;
}

/** Every route relation in the response, with stops in member order (stop roles, else platforms). */
export function routes(osm: OsmIndex): RouteRecord[] {
  const masterOf = new Map<number, OsmRelation>();
  for (const r of osm.relations.values()) {
    if (r.tags?.type !== "route_master") continue;
    for (const m of r.members) if (m.type === "relation") masterOf.set(m.ref, r);
  }
  const out: RouteRecord[] = [];
  for (const r of osm.relations.values()) {
    const tags = r.tags ?? {};
    if (tags.type !== "route" || !tags.route) continue;
    const master = masterOf.get(r.id);
    const pick = (kind: "stop" | "platform") =>
      r.members.filter((m) => m.type !== "relation" && role(m.role) === kind && osm.position(m)).map((m) => osmId(m.type, m.ref));
    const onTrack = pick("stop");
    const path = r.members
      .filter((m) => m.type === "way" && !role(m.role))
      .map((m) => osm.wayCoords(m.ref))
      .filter((p): p is LonLat[] => !!p && p.length > 1);
    const field = (k: "ref" | "name" | "network" | "operator") => tags[k] ?? master?.tags?.[k];
    out.push({
      id: osmId("relation", r.id),
      master: master && osmId("relation", master.id),
      info: { ref: field("ref"), name: field("name"), network: field("network"), operator: field("operator"), osm: tags },
      tags,
      masterTags: master?.tags,
      stops: onTrack.length ? onTrack : pick("platform"),
      path,
    });
  }
  return out.sort((a, b) => compareIds(a.id, b.id));
}

/** Stops and platforms the routes use, plus the stations of the stop areas they belong to. */
export function stopCandidates(osm: OsmIndex, used: Iterable<RouteRecord>): StopCandidate[] {
  const area = new Map<string, { id: string; name?: string }>();
  const areaMembers = new Map<string, OsmMember[]>();
  for (const r of osm.relations.values()) {
    if (r.tags?.public_transport !== "stop_area") continue;
    const a = { id: osmId("relation", r.id), name: r.tags.name };
    areaMembers.set(a.id, r.members);
    for (const m of r.members) if (m.type !== "relation") area.set(osmId(m.type, m.ref), a);
  }

  const byId = new Map<string, OsmMember>();
  for (const r of used) {
    const rel = osm.relations.get(Number(r.id.slice(1)));
    for (const m of rel?.members ?? []) if (m.type !== "relation" && role(m.role)) byId.set(osmId(m.type, m.ref), m);
  }
  // Stations of those stop areas give a better position for the whole cluster.
  for (const id of [...byId.keys()]) {
    const a = area.get(id);
    for (const m of (a && areaMembers.get(a.id)) ?? []) {
      if (m.type !== "relation" && isStation(osm.tags(m))) byId.set(osmId(m.type, m.ref), m);
    }
  }

  const out: StopCandidate[] = [];
  for (const [id, m] of byId) {
    const geo = osm.position(m);
    if (!geo) continue;
    const t = osm.tags(m);
    out.push({ id, name: t.name, geo, area: area.get(id), station: isStation(t) || undefined, wikidata: t.wikidata });
  }
  return out.sort((a, b) => compareIds(a.id, b.id));
}

/** Orders "n2" < "n10" < "r1" < "w1": by type letter, then numerically. */
export function compareIds(a: string, b: string): number {
  return a[0] === b[0] ? Number(a.slice(1)) - Number(b.slice(1)) : a < b ? -1 : 1;
}
