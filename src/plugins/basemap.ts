import { geoPath } from "d3-geo";
import type { Feature, FeatureCollection } from "geojson";
import { getJson, type Ctx, type Plugin } from "../renderer";
import type { BasemapIndex, BasemapSnap } from "../schema";

export interface LayerStyle { fill?: string; stroke?: string; width?: number; dash?: number[] }
interface Layer { kind: string; path: Path2D }

export const BASEMAP_STYLE: Record<string, LayerStyle> = {
  land:     { fill: "#f4f1ea" },
  green:    { fill: "#dde8cf" },
  water:    { fill: "#bcd5ea" },
  waterway: { stroke: "#bcd5ea", width: 2 },
  road:     { stroke: "#d9d3c7", width: 1.2 },
  rail:     { stroke: "#b8b2a7", width: 0.8, dash: [4, 3] },
};

export interface BasemapOptions { url: string; maxAgeYears?: number; style?: Record<string, LayerStyle> }

export function basemap({ url, maxAgeYears = 15, style = BASEMAP_STYLE }: BasemapOptions): Plugin {
  const kinds = Object.keys(style);
  const cache = new Map<string, Promise<void> | Layer[]>();
  let index: BasemapIndex = { current: null, snapshots: [] };
  let shown: Layer[] | null = null;
  let generation = 0;

  function pick(year: number): BasemapSnap | null {
    const hist = index.snapshots
      .filter((s) => s.year <= year && year - s.year <= maxAgeYears)
      .sort((a, b) => b.year - a.year)[0] as BasemapSnap | undefined;
    return hist ?? index.current;
  }

  async function load(ctx: Ctx, src: string) {
    const gen = generation;
    const fc = await getJson<FeatureCollection>(src);
    if (gen !== generation) return;   // projection changed while loading
    const path = geoPath(ctx.projection);
    const byKind = new Map<string, Feature[]>();
    for (const f of fc?.features ?? []) {
      const kind = String(f.properties?.kind ?? "");
      if (!style[kind]) continue;
      let list = byKind.get(kind);
      if (!list) byKind.set(kind, (list = []));
      list.push(f);
    }
    const layers = [...byKind]
      .sort(([a], [b]) => kinds.indexOf(a) - kinds.indexOf(b))
      .map(([kind, features]) => ({ kind, path: new Path2D(path({ type: "FeatureCollection", features }) ?? "") }));
    cache.set(src, layers);
    ctx.redraw();
  }

  function layersFor(ctx: Ctx, snap: BasemapSnap): Layer[] | null {
    const hit = cache.get(snap.url);
    if (Array.isArray(hit)) return hit;
    if (!hit) cache.set(snap.url, load(ctx, snap.url));
    return null;
  }

  return {
    id: "basemap",
    order: 0,
    async init() {
      index = (await getJson<BasemapIndex>(url)) ?? index;
    },
    onProject() {
      generation++;
      cache.clear();
      shown = null;
    },
    draw(ctx) {
      const alpha = 1 - ctx.state.morph;
      const snap = pick(ctx.state.year);
      if (alpha <= 0.01 || !snap) { ctx.setBadge("basemap", null); return; }
      ctx.setBadge("basemap", snap.year != null
        ? `Base map: ${snap.year}, ${snap.source}`
        : `Base map: present day (no historical map for ${Math.floor(ctx.state.year)})`);
      shown = layersFor(ctx, snap) ?? shown;   // keep the previous snapshot until the next one loads
      if (!shown) return;
      const { g } = ctx;
      g.globalAlpha = alpha;
      for (const { kind, path } of shown) {
        const s = style[kind];
        if (s.fill) { g.fillStyle = s.fill; g.fill(path); }
        if (s.stroke) {
          g.strokeStyle = s.stroke;
          g.lineWidth = ctx.px(s.width ?? 1);
          g.setLineDash((s.dash ?? []).map((d) => ctx.px(d)));
          g.stroke(path);
        }
      }
    },
  };
}
