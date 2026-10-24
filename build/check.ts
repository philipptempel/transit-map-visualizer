// Validates the data under public/data/ against what the renderer expects.
//   npm run check-data                     every map in the catalog that has data
//   npm run check-data -- stuttgart        just these
//   npm run check-data -- --root some/dir  a different data directory (holding maps.json)

import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { BasemapIndex, BBox, DateLike, Landmark, LonLat, MapEntry, MapType, NetworkFile } from "../src/schema";
import type { MapConfig } from "./config";
import { loadConfigs } from "./load";

export const DATA_ROOT = resolve(import.meta.dirname, "..", "public", "data");

const MB = 1024 * 1024;
/** Raw network.json size per map type, before gzip. */
export const BUDGET: Record<MapType, number> = {
  local: 1.5 * MB, regional: 1.5 * MB, national: 5 * MB, continental: 5 * MB, global: 5 * MB,
};

const TYPES: MapType[] = ["local", "regional", "national", "continental", "global"];
const NETWORKS = ["transit", "rail", "air", "sea"];
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A date as a decimal year, null when absent, NaN when malformed. */
export function dateValue(d: DateLike): number | null {
  if (d == null) return null;
  if (typeof d === "number") return Number.isFinite(d) ? d : NaN;
  const m = d.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!m) return NaN;
  const [y, mo = 1, day = 1] = [m[1], m[2], m[3]].filter((x) => x != null).map(Number);
  if (mo < 1 || mo > 12 || day < 1 || day > DAYS[mo - 1]) return NaN;
  return y + ((mo - 1) * 30.44 + (day - 1)) / 365.25;
}

function checkDates(where: string, x: { start?: DateLike; end?: DateLike }, out: string[]) {
  const s = dateValue(x.start), e = dateValue(x.end);
  if (Number.isNaN(s)) out.push(`${where}: start ${JSON.stringify(x.start)} is not a date`);
  if (Number.isNaN(e)) out.push(`${where}: end ${JSON.stringify(x.end)} is not a date`);
  if (s != null && e != null && s > e) out.push(`${where}: starts (${x.start}) after it ends (${x.end})`);
}

/** The bbox grown by `frac` of its size on every side (at least 0.02°). */
export function grow([w, s, e, n]: BBox, frac: number): BBox {
  const dx = Math.max((e - w) * frac, 0.02), dy = Math.max((n - s) * frac, 0.02);
  return [w - dx, s - dy, e + dx, n + dy];
}

/**
 * Where a map's coordinates may lie: the bbox plus a margin, wider for whole-line maps, whose
 * lines may run out of the bbox. The network stage drops routes that leave it.
 */
export const mapBounds = (bbox: BBox, clip?: MapConfig["clip"]) => grow(bbox, clip === "whole-line" ? 1 : 0.5);

const inside = ([lon, lat]: LonLat, [w, s, e, n]: BBox) => lon >= w && lon <= e && lat >= s && lat <= n;
const isLonLat = (p: unknown): p is LonLat =>
  Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v));

export interface CheckOptions {
  bounds?: BBox;            // coordinates must lie inside; omit to skip (global maps)
}

/** Problems with one network.json; empty when it's fine. */
export function checkNetwork(net: NetworkFile, opts: CheckOptions = {}): string[] {
  const out: string[] = [];
  const where = (p: LonLat) => `[${p.join(", ")}]`;
  const coord = (what: string, p: unknown) => {
    if (!isLonLat(p)) out.push(`${what}: ${JSON.stringify(p)} is not a [lon, lat] pair`);
    else if (opts.bounds && !inside(p, opts.bounds)) out.push(`${what}: ${where(p)} lies outside the map's bbox`);
  };

  const groupModes = new Set(net.groups.flatMap((g) => g.modes));
  for (const g of net.groups) if (g.coverage?.from != null) checkDates(`group ${g.id} coverage`, { start: g.coverage.from }, out);

  const lines = new Set<string>();
  for (const l of net.lines) {
    if (lines.has(l.id)) out.push(`line ${l.id}: id used twice`);
    lines.add(l.id);
  }

  const stops = new Set<string>();
  for (const s of net.stops) {
    if (stops.has(s.id)) out.push(`stop ${s.id}: id used twice`);
    stops.add(s.id);
    coord(`stop ${s.id}`, s.geo);
    checkDates(`stop ${s.id}`, s, out);
  }

  net.segments.forEach((seg, i) => {
    const name = `segment ${i} (${seg.from} → ${seg.to})`;
    if (!stops.has(seg.from)) out.push(`${name}: no stop "${seg.from}"`);
    if (!stops.has(seg.to)) out.push(`${name}: no stop "${seg.to}"`);
    if (seg.from === seg.to) out.push(`${name}: starts and ends at the same stop`);
    if (!groupModes.has(seg.mode)) out.push(`${name}: mode "${seg.mode}" is in no group, so it would not be drawn`);
    checkDates(name, seg, out);
    for (const l of seg.lines ?? []) {
      const ref = typeof l === "string" ? { id: l } : l;
      if (!lines.has(ref.id)) out.push(`${name}: no line "${ref.id}"`);
      checkDates(`${name}, line ${ref.id}`, ref, out);
    }
    seg.geo?.forEach((p, k) => coord(`${name}, point ${k}`, p));
  });
  return out;
}

export function checkLandmarks(items: Landmark[], stops: Set<string>, opts: CheckOptions = {}): string[] {
  const out: string[] = [];
  for (const it of items) {
    const name = `landmark ${it.name}`;
    if (!isLonLat(it.geo)) out.push(`${name}: ${JSON.stringify(it.geo)} is not a [lon, lat] pair`);
    else if (opts.bounds && !inside(it.geo, opts.bounds)) out.push(`${name}: lies outside the map's bbox`);
    if (it.anchor && !stops.has(it.anchor)) out.push(`${name}: anchor "${it.anchor}" is no stop`);
    checkDates(name, it, out);
  }
  return out;
}

export function checkEntry(e: MapEntry): string[] {
  const out: string[] = [];
  if (!TYPES.includes(e.type)) out.push(`type "${e.type}" is not one of ${TYPES.join(", ")}`);
  if (!NETWORKS.includes(e.network)) out.push(`network "${e.network}" is not one of ${NETWORKS.join(", ")}`);
  const [w, s, east, n] = e.bbox ?? [];
  if (!(w < east && s < n && w >= -180 && east <= 180 && s >= -90 && n <= 90)) out.push(`bbox ${JSON.stringify(e.bbox)} is not [west, south, east, north]`);
  return out;
}

const readJson = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`${file}: ${(err as Error).message}`);
  }
};
const exists = (file: string) => stat(file).then(() => true, () => false);

/** Everything wrong with one map's files. `root` is the data directory, which sits inside the site root. */
export async function checkMap(root: string, e: MapEntry, cfg?: MapConfig): Promise<string[]> {
  const out = checkEntry(e);
  const dir = join(root, e.id);
  const bounds = e.type === "global" || out.length ? undefined : mapBounds(e.bbox, cfg?.clip);

  const file = join(dir, "network.json");
  let net: NetworkFile | null;
  try {
    net = await readJson<NetworkFile>(file);
  } catch (err) {
    return [...out, (err as Error).message];
  }
  if (!net) return [...out, "network.json is missing"];
  const size = (await stat(file)).size;
  if (size > BUDGET[e.type]) out.push(`network.json is ${(size / MB).toFixed(2)} MB, over the ${BUDGET[e.type] / MB} MB budget for a ${e.type} map`);
  out.push(...checkNetwork(net, { bounds }));

  try {
    const marks = await readJson<Landmark[]>(join(dir, "landmarks.json"));
    if (marks) out.push(...checkLandmarks(marks, new Set(net.stops.map((s) => s.id)), { bounds }).map((p) => `landmarks.json: ${p}`));
    const index = await readJson<BasemapIndex>(join(dir, "basemap", "index.json"));
    for (const snap of [index?.current, ...(index?.snapshots ?? [])]) {
      if (snap && !(await exists(join(dirname(root), snap.url)))) out.push(`basemap/index.json: ${snap.url} does not exist`);
    }
  } catch (err) {
    out.push((err as Error).message);
  }
  return out;
}

export interface Report { id: string; problems: string[] }

/** Checks every map in `root`/maps.json that is not planned, or just `ids`. */
export async function checkAll(root = DATA_ROOT, ids: string[] = []): Promise<Report[]> {
  const catalog = await readJson<MapEntry[]>(join(root, "maps.json"));
  if (!catalog) return [{ id: "maps.json", problems: [`${join(root, "maps.json")} is missing`] }];
  const reports: Report[] = [];
  const seen = new Set<string>(), dupes: string[] = [];
  for (const e of catalog) {
    if (seen.has(e.id)) dupes.push(e.id);
    seen.add(e.id);
  }
  if (dupes.length) reports.push({ id: "maps.json", problems: dupes.map((id) => `id "${id}" listed twice`) });

  const configs = await loadConfigs();
  for (const id of ids) if (!catalog.some((e) => e.id === id)) reports.push({ id, problems: ["not in maps.json"] });
  for (const e of catalog) {
    if (ids.length ? !ids.includes(e.id) : e.status === "planned") continue;
    reports.push({ id: e.id, problems: await checkMap(root, e, configs.get(e.id)) });
  }
  return reports;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { root: { type: "string" } } });
  const reports = await checkAll(values.root ? resolve(values.root) : DATA_ROOT, positionals);
  let bad = 0;
  for (const r of reports) {
    if (!r.problems.length) { console.log(`ok    ${r.id}`); continue; }
    bad++;
    console.log(`FAIL  ${r.id}`);
    for (const p of r.problems) console.log(`      ${p}`);
  }
  if (bad) process.exitCode = 1;
}

if (import.meta.filename === process.argv[1]) await main();
