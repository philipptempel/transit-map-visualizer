import { cutAt, getJson, offset, resample, toYear, type Life, type Plugin, type Point } from "../renderer";
import type { DateLike, GroupDef, LonLat, NetworkFile, Stop } from "../schema";
import { lineOrder, orient, slots, type Orientation } from "./orient";

declare module "../renderer" {
  interface Services {
    /** Current on-screen position of a stop, following the geo ↔ schematic morph. */
    stop: (id: string) => Point | undefined;
  }
}

interface Strand { id?: string; color: string; start?: DateLike; end?: DateLike }
interface ProjectedStop extends Stop { g: Point; s: Point }
interface Seg {
  i: number;                       // index in the network file
  from: string; to: string; start?: DateLike; end?: DateLike;
  /** Drawn from `to` to `from` to keep parallel lines on their side, so it grows back from the far end. */
  flipped: boolean;
  group: GroupDef; lines: Strand[]; ga: Point[]; sa: Point[];
}

export interface NetworkOptions { url: string; samples?: number; lineWidth?: number; lineGap?: number; labelZoom?: number }

const mix = (a: Point[], b: Point[], m: number): Point[] =>
  a.map((p, i): Point => [p[0] + (b[i][0] - p[0]) * m, p[1] + (b[i][1] - p[1]) * m]);

export function network({ url, samples = 24, lineWidth = 3, lineGap = 3.5, labelZoom = 2.5 }: NetworkOptions): Plugin {
  let data: NetworkFile = { groups: [], lines: [], stops: [], segments: [] };
  let segs: Seg[] = [];
  let stops = new Map<string, ProjectedStop>();
  let chain: Orientation = { flip: [], prev: [], next: [] };
  let order = new Map<string, number>();

  return {
    id: "network",
    order: 10,

    async init(ctx) {
      const json = await getJson<NetworkFile>(url);
      if (!json) throw new Error(`Missing ${url}`);
      data = json;
      data.groups.forEach((gd) => ctx.addGroup(gd));
      const groupOf = new Map(data.groups.flatMap((gd) => gd.modes.map((m) => [m, gd.id] as const)));
      chain = orient(data.segments, (seg) => groupOf.get(seg.mode));
      order = lineOrder(data.lines);
      [...data.segments, ...data.stops].forEach((x) => ctx.extendRange(x.start, x.end));
      // A group's data starts at its coverage, so a map of today's network alone opens on today.
      data.groups.forEach((gd) => ctx.extendRange(gd.coverage?.from));
      ctx.provide("stop", (id) => {
        const s = stops.get(id);
        return s && ctx.lerp(s.g, s.s);
      });
    },

    onProject(ctx) {
      const P = ctx.project;
      const groupOf = new Map(data.groups.flatMap((gd) => gd.modes.map((m) => [m, gd] as const)));
      const lineById = new Map(data.lines.map((l) => [l.id, l] as const));
      stops = new Map(data.stops.map((s) => [s.id, { ...s, g: P(s.geo), s: P(s.schem ?? s.geo) }] as const));

      segs = data.segments.flatMap((raw, i): Seg[] => {
        const group = groupOf.get(raw.mode), a = stops.get(raw.from), b = stops.get(raw.to);
        if (!group || !a || !b) return [];
        let { from, to } = raw;
        let geo: LonLat[] = raw.geo ?? [a.geo, b.geo];
        let sch: LonLat[] = raw.schem ?? [a.schem ?? a.geo, b.schem ?? b.geo];
        const flipped = chain.flip[i];
        if (flipped) {
          [from, to] = [to, from];
          geo = [...geo].reverse();
          sch = [...sch].reverse();
        }
        const lines = (raw.lines ?? []).map((l): Strand => {
          const ref = typeof l === "string" ? { id: l } : l;
          return { ...ref, color: lineById.get(ref.id)?.color ?? group.color };
        });
        return [{
          i, from, to, start: raw.start, end: raw.end, flipped, group, lines,
          ga: resample(geo.map(P), samples),
          sa: resample(sch.map(P), samples),
        }];
      });
    },

    draw(ctx) {
      const { g, state } = ctx;
      const touched = new Set<string>();
      const gap = ctx.px(lineGap);
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = ctx.px(lineWidth);

      // Which lines run on each visible segment this year; a stop's layout depends on both sides.
      const shown = new Map<number, { s: Seg; life: Life; vis: number; strands: Strand[] }>();
      for (const s of segs) {
        if (!ctx.isOn(s.group.id)) continue;
        const vis = s.group.schematic ? 1 : 1 - state.morph;
        const life = ctx.life(s.start, s.end);
        if (vis <= 0.01 || life.alpha <= 0) continue;
        const running = s.lines.filter((l) => ctx.life(l.start, l.end).alpha > 0);
        shown.set(s.i, { s, life, vis, strands: running.length ? running : [{ color: s.group.color }] });
      }
      const ids = (strands: Strand[]) => strands.flatMap((l) => (l.id ? [l.id] : []));

      for (const { s, life, vis, strands } of shown.values()) {
        // At each end, lay out this segment's lines together with those of the segment it chains
        // into there, so a line running through the stop keeps its place; in between, ease across.
        const own = ids(strands);
        const atEnd = (other: number | undefined) =>
          slots([...own, ...ids(shown.get(other ?? -1)?.strands ?? [])], order, gap);
        const d0 = atEnd(chain.prev[s.i]), d1 = atEnd(chain.next[s.i]);
        const full = mix(s.ga, s.sa, state.morph);
        const last = full.length - 1;
        g.globalAlpha = life.alpha * vis;
        for (const l of strands) {
          const a = (l.id && d0.get(l.id)) || 0, b = (l.id && d1.get(l.id)) || 0;
          const pts = offset(full, (k) => { const t = k / last; return a + (b - a) * t * t * (3 - 2 * t); });
          // Grow from the segment's own `from`; cut a flipped one from the far end and turn it back.
          const path = s.flipped ? cutAt(pts.reverse(), life.grow).reverse() : cutAt(pts, life.grow);
          g.strokeStyle = l.color;
          g.beginPath();
          path.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.stroke();
        }
        if (life.alpha * vis > 0.5) {
          const [head, tail] = s.flipped ? [s.to, s.from] : [s.from, s.to];
          touched.add(head);
          if (life.grow >= 1) touched.add(tail);
        }
      }

      g.globalAlpha = 1;
      g.lineWidth = ctx.px(1.2);
      g.strokeStyle = "#222";
      g.font = `${ctx.px(11)}px system-ui, sans-serif`;
      for (const id of touched) {
        const st = stops.get(id);
        if (!st) continue;
        const [x, y] = ctx.lerp(st.g, st.s);
        g.fillStyle = "#fff";
        g.beginPath();
        g.arc(x, y, ctx.px(3), 0, 2 * Math.PI);
        g.fill();
        g.stroke();
        if (state.t.k >= labelZoom) {
          g.fillStyle = "#333";
          g.fillText(st.name, x + ctx.px(5), y - ctx.px(4));
        }
      }

      const gaps = data.groups
        .filter((gd) => ctx.isOn(gd.id) && gd.coverage?.from && state.year < (toYear(gd.coverage.from) ?? -Infinity))
        .map((gd) => `${gd.label}: data from ${String(gd.coverage?.from).slice(0, 4)}`);
      ctx.setBadge("coverage", gaps.join(" · "));
    },
  };
}
