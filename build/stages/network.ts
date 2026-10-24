// The network stage: today's routes from OSM, as network.json. No history yet; every group's
// coverage starts in the current year, so the map says plainly that it shows today's network.

import type { BBox, GroupDef, Line, LonLat, Mode, NetworkFile, Segment, Stop } from "../../src/schema";
import { classify, included } from "../classify";
import { DEFAULT_GROUPS, type MapConfig } from "../config";
import { buildSegments, type RouteForGraph } from "../graph/segments";
import { PRECISION, roundPoint, tidy } from "../graph/simplify";
import { dedupeStops } from "../graph/stops";
import { compareIds, OsmIndex, routes, stopCandidates, type RouteRecord, type Tags } from "../sources/osm";

const ROUTES = ["tram", "light_rail", "subway", "monorail", "train", "bus", "trolleybus", "ferry", "funicular", "aerialway"];

/**
 * Route relations touching the bbox, their route_masters, their member stops and ways (with
 * geometry), and the stop areas those stops belong to, with the stations in them.
 */
export function routesQuery([w, s, e, n]: BBox): string {
  return [
    `[out:json][timeout:900];`,
    `rel["type"="route"]["route"~"^(${ROUTES.join("|")})$"](${s},${w},${n},${e})->.routes;`,
    `rel(br.routes)["type"="route_master"]->.masters;`,
    `node(r.routes)->.stops;`,
    `way(r.routes)->.ways;`,
    `rel(bn.stops)["public_transport"="stop_area"]->.areas;`,
    `node(r.areas)->.areanodes;`,
    `(.routes; .masters; .areas;);`,
    `out body;`,
    `(.stops; .areanodes;);`,
    `out body;`,
    `.ways;`,
    `out geom;`,
  ].join("\n");
}

/** "#F00" → "#ff0000"; CSS names pass through in lowercase; anything else is dropped. */
export function colour(c: string | undefined): string | undefined {
  const v = c?.trim().toLowerCase();
  if (!v) return undefined;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((x) => x + x).join("")}`;
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  return /^[a-z]+$/.test(v) ? v : undefined;
}

const inside = ([lon, lat]: LonLat, [w, s, e, n]: BBox) => lon >= w && lon <= e && lat >= s && lat <= n;

export interface NetworkBuild { file: NetworkFile; report: string[] }

/** `year` is the year the OSM data is from; groups' coverage starts there. */
export function buildNetwork(osm: OsmIndex, cfg: MapConfig, year: number): NetworkBuild {
  const report: string[] = [];
  const { tolerance, decimals } = PRECISION[cfg.scope];

  // Classify, and keep what the profile includes.
  const kept: { r: RouteRecord; mode: Mode }[] = [];
  const skipped = new Map<string, number>();
  for (const r of routes(osm)) {
    const mode = classify(r.info, cfg);
    const why = !mode ? `route=${r.tags.route} unclassified` : !included(mode, cfg) ? `${mode} not in profile` : null;
    if (why) skipped.set(why, (skipped.get(why) ?? 0) + 1);
    else if (!r.stops.length) skipped.set("no stops", (skipped.get("no stops") ?? 0) + 1);
    else kept.push({ r, mode: mode! });
  }

  // Lines: a route_master, else routes that share mode, network and ref (both directions), else the route alone.
  const lineKey = ({ r, mode }: (typeof kept)[number]) =>
    r.master ?? (r.info.ref ? `${mode}|${r.info.network ?? ""}|${r.info.ref}` : r.id);
  const byLine = new Map<string, (typeof kept)[number][]>();
  for (const k of kept) byLine.set(lineKey(k), [...(byLine.get(lineKey(k)) ?? []), k]);
  const lineOf = new Map<string, string>();
  const lines: Line[] = [];
  for (const members of byLine.values()) {
    const first = members[0];
    const id = first.r.master ?? first.r.id;   // routes are sorted, so this is the lowest id
    const tags: Tags = first.r.masterTags ?? first.r.tags;
    const count = new Map<Mode, number>();
    for (const m of members) count.set(m.mode, (count.get(m.mode) ?? 0) + 1);
    const mode = [...count].sort((a, b) => b[1] - a[1])[0][0];   // the commonest; ties keep route order
    const line: Line = { id, mode };
    if (first.r.info.ref) line.ref = first.r.info.ref;
    const name = tags.name ?? (members.length === 1 ? first.r.tags.name : undefined);
    if (name) line.name = name;
    const c = colour(tags.colour ?? members.map((m) => m.r.tags.colour).find(Boolean));
    if (c) line.color = c;
    lines.push(line);
    for (const m of members) lineOf.set(m.r.id, id);
  }
  lines.sort((a, b) => compareIds(a.id, b.id));

  // Stops and segments.
  const cands = stopCandidates(osm, kept.map((k) => k.r));
  const { stops: graphStops, stopOf } = dedupeStops(cands);
  const candGeo = new Map(cands.map((c) => [c.id, c.geo] as const));
  const forGraph: RouteForGraph[] = kept.map(({ r, mode }) => ({
    line: lineOf.get(r.id)!,
    mode,
    stops: r.stops.filter((s) => candGeo.has(s)).map((s) => ({ stop: stopOf.get(s)!, geo: candGeo.get(s)! })),
    path: r.path,
  }));
  let segments = buildSegments(forGraph);

  const geoOf = new Map(graphStops.map((s) => [s.id, s.geo] as const));
  if (cfg.clip === "bbox") {
    const before = segments.length;
    segments = segments.filter((s) => inside(geoOf.get(s.from)!, cfg.bbox) || inside(geoOf.get(s.to)!, cfg.bbox));
    if (before > segments.length) report.push(`clip: dropped ${before - segments.length} segments outside the bbox`);
  }
  segments = segments.map((s): Segment => {
    if (!s.geo) return s;
    const geo = tidy(s.geo, tolerance, decimals);
    return { ...s, geo };
  });

  const used = new Set(segments.flatMap((s) => [s.from, s.to]));
  const stops: Stop[] = graphStops
    .filter((s) => used.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, geo: roundPoint(s.geo, decimals) }));
  const usedLines = new Set(segments.flatMap((s) => (s.lines ?? []).map((l) => (typeof l === "string" ? l : l.id))));

  // Groups: those with a mode that occurs. No history yet, so coverage starts this year.
  const modes = new Set(segments.map((s) => s.mode));
  const groups: GroupDef[] = (cfg.groups ?? DEFAULT_GROUPS)
    .filter((g) => g.modes.some((m) => modes.has(m)))
    .map((g) => ({ ...g, coverage: { from: String(year) } }));
  const orphan = [...modes].filter((m) => !groups.some((g) => g.modes.includes(m)));
  if (orphan.length) report.push(`warning: no group for ${orphan.join(", ")}; those segments would not be drawn`);

  const perMode = new Map<Mode, number>();
  for (const s of segments) perMode.set(s.mode, (perMode.get(s.mode) ?? 0) + 1);
  report.push(`routes: ${kept.length} kept${skipped.size ? `; skipped ${[...skipped].map(([k, v]) => `${v} ${k}`).join(", ")}` : ""}`);
  report.push(`segments: ${segments.length} (${[...perMode].map(([m, n]) => `${m} ${n}`).join(", ")}); ${segments.filter((s) => !s.geo).length} straight`);
  report.push(`stops: ${stops.length}, lines: ${usedLines.size}`);

  return { file: { groups, lines: lines.filter((l) => usedLines.has(l.id)), stops, segments }, report };
}

/** One array element per line: small diffs between runs, without the bulk of full indentation. */
export function formatNetwork(f: NetworkFile): string {
  const list = (items: unknown[]) => (items.length ? `[\n${items.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]` : "[]");
  return `{\n  "groups": ${list(f.groups)},\n  "lines": ${list(f.lines)},\n  "stops": ${list(f.stops)},\n  "segments": ${list(f.segments)}\n}\n`;
}
