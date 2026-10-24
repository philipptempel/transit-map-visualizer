// The stages fetch runs per map. Each fetches through the cache, builds, and writes its files.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NetworkFile } from "../../src/schema";
import type { MapConfig } from "../config";
import { writeIfChanged } from "../out/write";
import type { CacheOptions } from "../sources/cache";
import { OsmIndex } from "../sources/osm";
import { overpass } from "../sources/overpass";
import { basemapFeatures, basemapIndex, basemapQuery, coverage, detailFor, formatFeatures, shapeBasemap } from "./basemap";
import { buildNetwork, formatDetail, formatNetwork, routesQuery } from "./network";

export const STAGES = ["network", "basemap", "landmarks"] as const;
export type Stage = (typeof STAGES)[number];

export interface StageContext { cfg: MapConfig; outDir: string; cache: CacheOptions; dryRun: boolean }
export interface StageResult {
  status: "done" | "todo";
  note?: string;
  details?: string[];       // what it found, for the summary
  attribution?: string[];   // credits for what this stage used
  changed?: boolean;        // wrote files that differ from before
}

export const OSM_CREDIT = "© OpenStreetMap contributors";

const notYet = async (): Promise<StageResult> => ({ status: "todo", note: "not implemented yet" });

async function network(ctx: StageContext): Promise<StageResult> {
  const res = await overpass(routesQuery(ctx.cfg.bbox), ctx.cache);
  // The year of the OSM snapshot, not of this run, so a rebuild from the cache comes out the same.
  const year = Number(res.osm3s?.timestamp_osm_base?.slice(0, 4)) || new Date().getFullYear();
  const { file, detail, report } = buildNetwork(new OsmIndex(res.elements), ctx.cfg, year);
  if (!file.segments.length) throw new Error("no segments: nothing in the bbox matched the profile");
  const text = formatNetwork(file), more = formatDetail(detail);
  const a = await writeIfChanged(join(ctx.outDir, "network.json"), text, ctx.dryRun);
  const b = await writeIfChanged(join(ctx.outDir, "network.detail.json"), more, ctx.dryRun);
  const mb = (t: string) => (Buffer.byteLength(t) / 1024 / 1024).toFixed(2);
  return {
    status: "done", note: `${mb(text)} MB + ${mb(more)} MB detail, OSM data of ${res.osm3s?.timestamp_osm_base ?? "unknown date"}`,
    details: report, attribution: [OSM_CREDIT], changed: a || b,
  };
}

async function basemap(ctx: StageContext): Promise<StageResult> {
  if (ctx.cfg.scope !== "city" && ctx.cfg.scope !== "region") return { status: "todo", note: "Natural Earth base maps not implemented yet" };
  // Cover the whole network as built (the network stage runs first), not just the configured bbox.
  const net = await readFile(join(ctx.outDir, "network.json"), "utf8").then((t) => JSON.parse(t) as NetworkFile, () => null);
  const area = coverage(net, ctx.cfg.bbox);
  const { interval, minArea } = detailFor(area, ctx.cfg.bbox);
  const res = await overpass(basemapQuery(area), ctx.cache);
  const fc = await shapeBasemap(basemapFeatures(new OsmIndex(res.elements)), { bbox: area, interval, minArea });
  const text = formatFeatures(fc);
  const dir = join(ctx.outDir, "basemap");
  const a = await writeIfChanged(join(dir, "current.json"), text, ctx.dryRun);
  const b = await writeIfChanged(join(dir, "index.json"), `${JSON.stringify(basemapIndex(ctx.cfg.id), null, 2)}\n`, ctx.dryRun);
  return {
    status: "done", note: `${fc.features.length} features, ${(text.length / 1024 / 1024).toFixed(2)} MB`,
    details: [`covers ${area.join(", ")}; simplified to ${interval} m, areas from ${(minArea / 10000).toFixed(1)} ha`],
    attribution: [OSM_CREDIT], changed: a || b,
  };
}

export const RUN: Record<Stage, (ctx: StageContext) => Promise<StageResult>> = {
  network,
  basemap,
  landmarks: notYet,
};
