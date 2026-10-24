// The basemap stage for cities and regions: water, green space, major roads and main-line rail
// from OSM, clipped to the bbox and simplified with mapshaper, as basemap/current.json.

import { geoArea } from "d3-geo";
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon, Position } from "geojson";
import mapshaper from "mapshaper";
import type { BasemapIndex, BBox, LonLat } from "../../src/schema";
import { joinWays } from "../graph/segments";
import type { OsmIndex, Tags } from "../sources/osm";

export function basemapQuery([w, s, e, n]: BBox): string {
  const bb = `(${s},${w},${n},${e})`;
  return [
    `[out:json][timeout:900];`,
    `(`,
    `  way["natural"="water"]${bb};`,
    `  way["waterway"~"^(river|canal)$"]${bb};`,
    `  way["landuse"="forest"]${bb}; way["natural"="wood"]${bb}; way["leisure"="park"]${bb};`,
    `  way["highway"~"^(motorway|trunk|primary)$"]${bb};`,
    `  way["railway"="rail"][!"service"]${bb};`,
    `)->.ways;`,
    `(`,
    `  rel["type"="multipolygon"]["natural"~"^(water|wood)$"]${bb};`,
    `  rel["type"="multipolygon"]["landuse"="forest"]${bb};`,
    `  rel["type"="multipolygon"]["leisure"="park"]${bb};`,
    `)->.rels;`,
    `way(r.rels)->.members;`,
    `.rels;`,
    `out body;`,
    `(.ways; .members;);`,
    `out geom;`,
  ].join("\n");
}

type Kind = "water" | "green" | "waterway" | "road" | "rail";

export function kindOf(t: Tags): Kind | null {
  if (t.natural === "water") return "water";
  if (t.landuse === "forest" || t.natural === "wood" || t.leisure === "park") return "green";
  if (t.waterway === "river" || t.waterway === "canal") return "waterway";
  if (/^(motorway|trunk|primary)$/.test(t.highway ?? "")) return "road";
  if (t.railway === "rail" && !t.service) return "rail";
  return null;
}

const AREA: Kind[] = ["water", "green"];
const closed = (r: LonLat[]) => r.length >= 4 && r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1];

/** Ray casting; good enough to put an inner ring into the outer ring that holds it. */
function contains(ring: Position[], [x, y]: Position): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** OSM ways and multipolygons as GeoJSON features with a `kind`, not yet clipped or simplified. */
export function basemapFeatures(osm: OsmIndex): Feature[] {
  const out: Feature[] = [];
  const ids = (m: number[]) => m.map((id) => osm.wayCoords(id)).filter((p): p is LonLat[] => !!p && p.length > 1);

  for (const r of [...osm.relations.values()].sort((a, b) => a.id - b.id)) {
    const kind = kindOf(r.tags ?? {});
    if (r.tags?.type !== "multipolygon" || !kind || !AREA.includes(kind)) continue;
    const ways = (role: string) => ids(r.members.filter((m) => m.type === "way" && (m.role || "outer") === role).map((m) => m.ref));
    const outers = joinWays(ways("outer")).filter(closed);
    const inners = joinWays(ways("inner")).filter(closed);
    if (!outers.length) continue;
    const polys: Position[][][] = outers.map((o) => [o]);
    for (const inner of inners) polys.find((p) => contains(p[0], inner[0]))?.push(inner);
    const geometry: MultiPolygon = { type: "MultiPolygon", coordinates: polys };
    out.push({ type: "Feature", properties: { kind }, geometry });
  }

  for (const w of [...osm.ways.values()].sort((a, b) => a.id - b.id)) {
    const kind = kindOf(w.tags ?? {});
    const pts = osm.wayCoords(w.id);
    if (!kind || !pts || pts.length < 2) continue;
    if (AREA.includes(kind)) {
      if (!closed(pts)) continue;
      const geometry: Polygon = { type: "Polygon", coordinates: [pts] };
      out.push({ type: "Feature", properties: { kind }, geometry });
    } else {
      const geometry: LineString = { type: "LineString", coordinates: pts };
      out.push({ type: "Feature", properties: { kind }, geometry });
    }
  }
  return out;
}

export interface BasemapOptions { bbox: BBox; interval: number; minArea: number }

async function run(fc: FeatureCollection, cmd: string): Promise<Feature[]> {
  if (!fc.features.length) return [];
  const out = await mapshaper.applyCommands(
    `-i in.json ${cmd} -o out.json format=geojson geojson-type=FeatureCollection precision=0.00001`, { "in.json": fc });
  return (JSON.parse(String(out["out.json"])) as FeatureCollection).features.filter((f) => f.geometry);
}

/**
 * d3-geo reads a ring's winding on the sphere: clockwise outer rings enclose the polygon, while
 * counter-clockwise ones (RFC 7946, and mapshaper's output) enclose everything else. A part
 * covering more than a hemisphere is wound the wrong way, so all its rings are reversed.
 */
export function windForD3(f: Feature): Feature {
  const fix = (rings: Position[][]) =>
    geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI ? rings.map((r) => [...r].reverse()) : rings;
  const g = f.geometry;
  if (g.type === "Polygon") return { ...f, geometry: { ...g, coordinates: fix(g.coordinates) } };
  if (g.type === "MultiPolygon") return { ...f, geometry: { ...g, coordinates: g.coordinates.map(fix) } };
  return f;
}

/** Clips to the bbox and simplifies to `interval` metres. Areas smaller than `minArea` m² go. */
export async function shapeBasemap(features: Feature[], o: BasemapOptions): Promise<FeatureCollection> {
  const clip = `-clip bbox=${o.bbox.join(",")}`;
  const simplify = `-simplify interval=${o.interval} keep-shapes`;
  const isArea = (f: Feature) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon";
  const areas = await run({ type: "FeatureCollection", features: features.filter(isArea) },
    `${clip} ${simplify} -filter-slivers min-area=${o.minArea} -filter "this.area >= ${o.minArea}"`);
  const lines = await run({ type: "FeatureCollection", features: features.filter((f) => !isArea(f)) }, `${clip} ${simplify}`);
  return { type: "FeatureCollection", features: [...areas.map(windForD3), ...lines] };
}

export const basemapIndex = (id: string): BasemapIndex => ({
  current: { url: `data/${id}/basemap/current.json`, source: "OpenStreetMap" },
  snapshots: [],
});

/** One feature per line, like network.json. */
export const formatFeatures = (fc: FeatureCollection) =>
  `{"type":"FeatureCollection","features":[\n${fc.features.map((f) => JSON.stringify(f)).join(",\n")}\n]}\n`;
