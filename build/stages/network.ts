// The network stage: today's routes from OSM, as network.json. No history yet; every group's
// coverage starts in the current year, so the map says plainly that it shows today's network.

import type { BBox, GroupDef, Line, LonLat, Mode, NetworkFile, Segment, Stop } from "../../src/schema";
import { BUDGET, mapBounds } from "../check";
import { classify, included, isCoach, isHeritage, test } from "../classify";
import { DEFAULT_GROUPS, SCOPE_TYPE, type MapConfig } from "../config";
import { anchorStops, snapEnds } from "../graph/anchor";
import { metres } from "../graph/geo";
import { buildSegments, stopAxes, type RouteForGraph } from "../graph/segments";
import { PRECISION, roundPoint, tidy } from "../graph/simplify";
import { dedupeStops, type Served } from "../graph/stops";
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

/** Fine geometry for network.detail.json, by segment index; null where network.json's is already exact. */
export type Detail = (LonLat[] | null)[];

export interface NetworkBuild { file: NetworkFile; detail: Detail; report: string[] }

/** Modes whose geometry gives way first when a file is over budget, and how far, step by step. */
const MINOR: Mode[] = ["bus", "trolleybus", "express_bus"];
const FIT_TOLERANCES = [15, 30, 60, 120, Infinity];   // metres; Infinity = straight segments

const describe = (r: RouteRecord) =>
  `${r.id} ${JSON.stringify(r.info.name ?? r.info.ref ?? "")} (route=${r.tags.route}${r.info.network ? `, network=${r.info.network}` : ""})`;
const tally = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/** `year` is the year the OSM data is from; groups' coverage starts there. */
export function buildNetwork(osm: OsmIndex, cfg: MapConfig, year: number, budget = BUDGET[SCOPE_TYPE[cfg.scope]]): NetworkBuild {
  const report: string[] = [];
  const precision = PRECISION[cfg.scope], { decimals } = precision;
  // Whole-line maps keep lines that touch the bbox, but not ones that run far beyond it.
  const bounds = cfg.clip === "whole-line" && cfg.scope !== "world" ? mapBounds(cfg.bbox, cfg.clip) : null;

  // Classify, keep what the profile includes, and drop routes that run off the map.
  const kept: { r: RouteRecord; mode: Mode }[] = [];
  const skipped = new Map<string, number>();
  const offMap: RouteRecord[] = [];
  const all = routes(osm);
  for (const r of all) {
    if (isHeritage(r.tags)) { tally(skipped, "heritage or tourist"); continue; }
    if (cfg.exclude?.some((m) => test(m, r.info))) { tally(skipped, "excluded by the map config"); continue; }
    const mode = classify(r.info, cfg);
    if (!mode) { tally(skipped, isCoach(r.tags) ? "long-distance coach" : `route=${r.tags.route} unclassified`); continue; }
    if (!included(mode, cfg)) { tally(skipped, `${mode} not in profile`); continue; }
    if (!r.stops.length) { tally(skipped, "no stops"); continue; }
    const pts = [...r.stops.map((id) => osm.position({ type: id[0] === "n" ? "node" : "way", ref: Number(id.slice(1)), role: "" })), ...r.path.flat()];
    if (bounds && pts.some((p) => p && !inside(p, bounds))) { tally(skipped, "running off the map"); offMap.push(r); continue; }
    kept.push({ r, mode });
  }
  report.push(`routes: ${kept.length} kept${skipped.size ? `; skipped ${[...skipped].map(([k, v]) => `${v} ${k}`).join(", ")}` : ""}`);
  if (offMap.length) {
    report.push(`off the map (beyond ${bounds!.map((v) => v.toFixed(2)).join(", ")}), e.g.:`);
    report.push(...offMap.slice(0, 8).map((r) => `  ${describe(r)}`));
  }

  // What each override caught, so it can be checked against the data.
  for (const o of cfg.overrides ?? []) {
    const rule = Object.entries(o.match).map(([k, v]) => `${k}=${v}`).join(" ");
    const hits = all.filter((r) => classify(r.info, { ...cfg, overrides: [o] }) === o.mode && classify(r.info, { ...cfg, overrides: [] }) !== o.mode);
    report.push(`override ${rule} → ${o.mode}: ${hits.length} route${hits.length === 1 ? "" : "s"}`);
    report.push(...hits.slice(0, 6).map((r) => `  ${describe(r)}`));
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
    const c = cfg.lineColors?.[mode] ?? colour(tags.colour ?? members.map((m) => m.r.tags.colour).find(Boolean));
    if (c) line.color = c;
    lines.push(line);
    for (const m of members) lineOf.set(m.r.id, id);
  }
  lines.sort((a, b) => compareIds(a.id, b.id));

  // Stops and segments.
  const cands = stopCandidates(osm, kept.map((k) => k.r));
  const candGeo = new Map(cands.map((c) => [c.id, c.geo] as const));
  // Which way the track runs at each platform, so platforms on crossing streets stay apart.
  const axes = stopAxes(kept.map(({ r }) => ({
    stops: r.stops.filter((s) => candGeo.has(s)).map((s) => ({ id: s, geo: candGeo.get(s)! })),
    path: r.path,
  })));
  // ...and which lines stop there, so one line's two platforms count as one stop.
  const groupOfMode = new Map((cfg.groups ?? DEFAULT_GROUPS).flatMap((g) => g.modes.map((m) => [m, g.id] as const)));
  const served = new Map<string, Served>();
  for (const { r, mode } of kept) {
    for (const st of r.stops) {
      const e = served.get(st) ?? { lines: new Set<string>(), groups: new Set<string>() };
      e.lines.add(lineOf.get(r.id)!);
      e.groups.add(groupOfMode.get(mode) ?? mode);
      served.set(st, e);
    }
  }
  const { stops: graphStops, stopOf } = dedupeStops(cands, 300, axes, served);
  const twins = [...new Set(graphStops.filter((a) => graphStops.some((b) =>
    a !== b && a.name && a.name === b.name && metres(a.geo, b.geo) <= 300)).map((st) => st.name))].sort();
  if (twins.length) report.push(`stops split where their tracks cross: ${twins.length}, e.g. ${twins.slice(0, 6).join("; ")}`);
  const forGraph: RouteForGraph[] = kept.map(({ r, mode }) => ({
    line: lineOf.get(r.id)!,
    mode,
    stops: r.stops.filter((s) => candGeo.has(s)).map((s) => ({ stop: stopOf.get(s)!, geo: candGeo.get(s)! })),
    path: r.path,
  }));
  let raw = buildSegments(forGraph);

  const geoOf = new Map(graphStops.map((s) => [s.id, s.geo] as const));
  if (cfg.clip === "bbox") {
    const before = raw.length;
    raw = raw.filter((s) => inside(geoOf.get(s.from)!, cfg.bbox) || inside(geoOf.get(s.to)!, cfg.bbox));
    if (before > raw.length) report.push(`clip: dropped ${before - raw.length} segments outside the bbox`);
  }

  // Groups: those with a mode that occurs. No history yet, so coverage starts this year.
  const modes = new Set(raw.map((s) => s.mode));
  const groups: GroupDef[] = (cfg.groups ?? DEFAULT_GROUPS)
    .filter((g) => g.modes.some((m) => modes.has(m)))
    .map((g) => ({ ...g, coverage: { from: String(year) } }));
  const orphan = [...modes].filter((m) => !groups.some((g) => g.modes.includes(m)));
  if (orphan.length) report.push(`warning: no group for ${orphan.join(", ")}; those segments would not be drawn`);

  // One point per stop, on its most prominent group's track (groups that fade in schematic view
  // count least), and every segment ends there.
  const rank = new Map<Mode, number>();
  [...groups].sort((a, b) => Number(!a.schematic) - Number(!b.schematic))
    .forEach((g, i) => g.modes.forEach((m) => { if (!rank.has(m)) rank.set(m, i); }));
  const anchors = anchorStops(raw, (m) => rank.get(m) ?? Infinity);
  raw = raw.map((s) => (s.geo ? { ...s, geo: snapEnds(s.geo, anchors.get(s.from)!, anchors.get(s.to)!) } : s));
  const moved = graphStops.flatMap((s) => (anchors.has(s.id) ? [metres(s.geo, anchors.get(s.id)!)] : [])).sort((a, b) => a - b);
  if (moved.length) report.push(`stops placed on their track: ${moved.length}, moved ${moved[Math.floor(moved.length / 2)].toFixed(0)} m (median), ${moved.at(-1)!.toFixed(0)} m at most`);

  const used = new Set(raw.flatMap((s) => [s.from, s.to]));
  const stops: Stop[] = graphStops
    .filter((s) => used.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, geo: roundPoint(anchors.get(s.id) ?? s.geo, decimals) }));
  const usedLines = new Set(raw.flatMap((s) => (s.lines ?? []).map((l) => (typeof l === "string" ? l : l.id))));

  // Coarse geometry in network.json; if that is over budget, the minor modes get coarser still.
  const shape = (minorTolerance: number) => raw.map((s): Segment => {
    if (!s.geo) return s;
    const t = MINOR.includes(s.mode) ? minorTolerance : precision.coarse;
    if (t === Infinity) { const { geo: _, ...rest } = s; return rest; }
    return { ...s, geo: tidy(s.geo, t, decimals) };
  });
  const make = (segments: Segment[]): NetworkFile => ({ groups, lines: lines.filter((l) => usedLines.has(l.id)), stops, segments });
  const size = (f: NetworkFile) => Buffer.byteLength(formatNetwork(f));
  let file = make(shape(precision.coarse));
  for (const t of FIT_TOLERANCES.filter((t) => t > precision.coarse)) {
    if (size(file) <= budget) break;
    file = make(shape(t));
    report.push(`over the ${(budget / 1024 / 1024).toFixed(1)} MB budget: ${MINOR.join("/")} geometry ${t === Infinity ? "left straight" : `simplified to ${t} m`}`);
  }

  // Fine geometry for the detail file, loaded after the first paint.
  const detail: Detail = raw.map((s, i) => {
    if (!s.geo) return null;
    const fine = tidy(s.geo, MINOR.includes(s.mode) ? precision.fine.minor : precision.fine.major, decimals);
    const coarse = file.segments[i].geo;
    return coarse && JSON.stringify(coarse) === JSON.stringify(fine) ? null : fine;
  });

  // What is in it, by mode.
  const perMode = new Map<Mode, { n: number; bytes: number }>();
  for (const s of file.segments) {
    const m = perMode.get(s.mode) ?? { n: 0, bytes: 0 };
    perMode.set(s.mode, { n: m.n + 1, bytes: m.bytes + JSON.stringify(s).length + 6 });
  }
  report.push(`segments: ${file.segments.length}; ${file.segments.filter((s) => !s.geo).length} straight`);
  report.push(...[...perMode].map(([m, { n, bytes }]) => `  ${m}: ${n} segments, ${(bytes / 1024).toFixed(0)} KB`));
  report.push(`stops: ${stops.length}, lines: ${file.lines.length}`);
  const byMode = new Map<Mode, Line[]>();
  for (const l of file.lines) byMode.set(l.mode, [...(byMode.get(l.mode) ?? []), l]);
  for (const [m, ls] of byMode) {
    if (MINOR.includes(m)) { report.push(`  ${m}: ${ls.length} lines, ${ls.filter((l) => !l.color).length} without a colour`); continue; }
    report.push(`  ${m}: ${ls.map((l) => `${l.ref ?? "?"}${l.color ? ` ${l.color}` : " (no colour)"}`).join(", ")}`);
  }

  const extra = detail.filter(Boolean).length;
  report.push(`detail: finer geometry for ${extra} of ${file.segments.length} segments`);
  return { file, detail, report };
}

/** The detail file: one segment's geometry (or null) per line, in network.json's segment order. */
export const formatDetail = (d: Detail) =>
  `{\n  "segments": [\n${d.map((g) => `    ${JSON.stringify(g)}`).join(",\n")}\n  ]\n}\n`;

/** One array element per line: small diffs between runs, without the bulk of full indentation. */
export function formatNetwork(f: NetworkFile): string {
  const list = (items: unknown[]) => (items.length ? `[\n${items.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]` : "[]");
  return `{\n  "groups": ${list(f.groups)},\n  "lines": ${list(f.lines)},\n  "stops": ${list(f.stops)},\n  "segments": ${list(f.segments)}\n}\n`;
}
