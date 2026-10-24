import { along, clamp01, cutAt, getJson, offset, resample, simplify, toYear, type Ctx, type Life, type Plugin, type Point } from "../renderer";
import type { DateLike, GroupDef, LonLat, NetworkFile, Stop } from "../schema";
import { lineOrder, orient, slots, spread, type Orientation } from "./orient";

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
  group: GroupDef; lines: Strand[];
  gp: Point[]; sp: Point[];        // the whole geometry, projected: geographic and schematic
  lod: Map<number, Point[]>[];     // [geographic, schematic] simplified per zoom level, built as needed
  morph: Map<number, [Point[], Point[]]>;   // both resampled to one count per zoom level, for the morph
  box: [x0: number, y0: number, x1: number, y1: number];   // around both layouts, to skip what is off screen
}

/** Zoom levels the geometry is simplified for: 2^-1 = 0.5× up to 2^6 = 64×. */
const LEVELS = [-1, 6] as const;

export interface NetworkOptions {
  url: string; samples?: number; lineWidth?: number; lineGap?: number; labelZoom?: number;
  /** Other stops fade in between these zooms; below, only those where something happens are shown. */
  stopZoom?: [number, number];
  /** Names of those other stops appear from this zoom; names of the rest from `labelZoom`. */
  minorLabelZoom?: number;
  /** Pixels a bundle of parallel lines may take at zoom 1; wider ones merge into one stroke until zoomed in. */
  bundleWidth?: number;
}

function bounds(pts: Point[]): Seg["box"] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

const mix = (a: Point[], b: Point[], m: number): Point[] =>
  a.map((p, i): Point => [p[0] + (b[i][0] - p[0]) * m, p[1] + (b[i][1] - p[1]) * m]);

/**
 * One point per stop, where all its segments end: the most central of its segments' track ends,
 * from its most prominent group (groups that fade in schematic view, the buses, count least).
 * The fetch step already puts stops there; this keeps older data and hand-written maps in line.
 */
export function trackPoints({ groups, segments }: NetworkFile): Map<string, LonLat> {
  const rank = new Map<string, number>();
  [...groups].sort((a, b) => Number(!a.schematic) - Number(!b.schematic))
    .forEach((g, i) => g.modes.forEach((m) => { if (!rank.has(m)) rank.set(m, i); }));
  const ends = new Map<string, { rank: number; pts: LonLat[] }>();
  for (const s of segments) {
    const r = rank.get(s.mode);
    if (r == null || !s.geo || s.geo.length < 2) continue;
    for (const [stop, p] of [[s.from, s.geo[0]], [s.to, s.geo[s.geo.length - 1]]] as const) {
      const e = ends.get(stop);
      if (!e || r < e.rank) ends.set(stop, { rank: r, pts: [p] });
      else if (r === e.rank) e.pts.push(p);
    }
  }
  const out = new Map<string, LonLat>();
  for (const [stop, { pts }] of ends) {
    let pick = pts[0], least = Infinity;
    for (const p of pts) {
      const sum = pts.reduce((t, q) => t + Math.hypot(p[0] - q[0], p[1] - q[1]), 0);
      if (sum < least) { least = sum; pick = p; }
    }
    out.set(stop, pick);
  }
  return out;
}

/**
 * Stops worth showing when zoomed out, per group: where a line ends, or where lines merge, split
 * or cross (three or more of the group's segments meet). A stop where two groups meet counts too;
 * that depends on which groups are on, so the renderer works it out as it draws.
 */
export function majorStops({ groups, segments }: NetworkFile): Map<string, Set<string>> {
  const groupOf = new Map(groups.flatMap((g) => g.modes.map((m) => [m, g.id] as const)));
  const degree = new Map<string, number>(), lineEnds = new Map<string, number>();
  for (const s of segments) {
    const g = groupOf.get(s.mode);
    if (!g) continue;
    for (const stop of [s.from, s.to]) {
      degree.set(`${g} ${stop}`, (degree.get(`${g} ${stop}`) ?? 0) + 1);
      for (const l of s.lines ?? []) {
        const k = `${g} ${stop} ${typeof l === "string" ? l : l.id}`;
        lineEnds.set(k, (lineEnds.get(k) ?? 0) + 1);
      }
    }
  }
  const out = new Map<string, Set<string>>();
  const mark = (g: string, stop: string) => out.set(stop, (out.get(stop) ?? new Set()).add(g));
  for (const [k, n] of degree) {
    const [g, stop] = k.split(" ");
    if (n !== 2) mark(g, stop);
  }
  for (const [k, n] of lineEnds) {
    const [g, stop] = k.split(" ");
    if (n === 1) mark(g, stop);
  }
  return out;
}

export function network({
  url, samples = 24, lineWidth = 3, lineGap = 3.5, labelZoom = 2.5, bundleWidth = 10, stopZoom = [2, 3], minorLabelZoom = 6,
}: NetworkOptions): Plugin {
  let data: NetworkFile = { groups: [], lines: [], stops: [], segments: [] };
  let segs: Seg[] = [];
  let stops = new Map<string, ProjectedStop>();
  let atStop = new Map<string, Seg[]>();   // group + stop → segments ending there
  let onTrack = new Map<string, LonLat>();      // where a stop and its segments' ends go
  let major = new Map<string, Set<string>>();   // stop → groups in which it matters when zoomed out
  let groupsAt = new Map<string, Set<string>>();   // stop → groups that serve it
  let lastCtx: Ctx | undefined;
  let chain: Orientation = { flip: [], prev: [], next: [] };
  let order = new Map<string, number>();
  let widest = new Map<string, number>();   // group id → most lines on one of its segments

  function project(ctx: Ctx) {
    lastCtx = ctx;
    const P = ctx.project;
    const groupOf = new Map(data.groups.flatMap((gd) => gd.modes.map((m) => [m, gd] as const)));
    const lineById = new Map(data.lines.map((l) => [l.id, l] as const));
    stops = new Map(data.stops.map((s) => [s.id, { ...s, g: P(onTrack.get(s.id) ?? s.geo), s: P(s.schem ?? s.geo) }] as const));

    segs = data.segments.flatMap((raw, i): Seg[] => {
      const group = groupOf.get(raw.mode), a = stops.get(raw.from), b = stops.get(raw.to);
      if (!group || !a || !b) return [];
      let { from, to } = raw;
      // Every segment meets the others where its stop is drawn (see trackPoints).
      const ga = onTrack.get(raw.from) ?? a.geo, gb = onTrack.get(raw.to) ?? b.geo;
      let geo: LonLat[] = raw.geo ? [ga, ...raw.geo.slice(1, -1), gb] : [ga, gb];
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
        gp: geo.map(P), sp: sch.map(P),
        lod: [new Map(), new Map()], morph: new Map(),
        box: bounds([...geo, ...sch].map(P)),
      }];
    });
    atStop = new Map();
    for (const sg of segs) {
      for (const st of [sg.from, sg.to]) {
        const k = `${sg.group.id} ${st}`;
        atStop.set(k, [...(atStop.get(k) ?? []), sg]);
      }
    }
  }

  return {
    id: "network",
    order: 10,

    async init(ctx) {
      const json = await getJson<NetworkFile>(url);
      if (!json) throw new Error(`Missing ${url}`);
      data = json;
      data.groups.forEach((gd) => ctx.addGroup(gd));
      const groupOf = new Map(data.groups.flatMap((gd) => gd.modes.map((m) => [m, gd.id] as const)));
      onTrack = trackPoints(data);
      major = majorStops(data);
      groupsAt = new Map();
      for (const seg of data.segments) {
        const g = groupOf.get(seg.mode);
        if (g) for (const st of [seg.from, seg.to]) groupsAt.set(st, (groupsAt.get(st) ?? new Set()).add(g));
      }
      // Finer geometry follows in the background; the map draws with what it has until then.
      getJson<{ segments?: (LonLat[] | null)[] }>(url.replace(/\.json$/, ".detail.json"))
        .then((detail) => {
          const list = detail?.segments;
          if (!Array.isArray(list) || list.length !== data.segments.length) return;
          list.forEach((g, i) => { if (Array.isArray(g) && g.length > 1) data.segments[i] = { ...data.segments[i], geo: g }; });
          onTrack = trackPoints(data);
          if (lastCtx) { project(lastCtx); lastCtx.redraw(); }
        })
        .catch(() => undefined);   // no detail file: the coarse geometry is all there is
      order = lineOrder(data.lines, data.segments, (seg) => groupOf.get(seg.mode));
      const stopGeo = new Map(data.stops.map((st) => [st.id, st.geo] as const));
      chain = orient(data.segments, (seg) => groupOf.get(seg.mode), {
        order,
        geo: (i) => data.segments[i].geo ?? [stopGeo.get(data.segments[i].from)!, stopGeo.get(data.segments[i].to)!],
      });
      widest = new Map();
      for (const seg of data.segments) {
        const id = groupOf.get(seg.mode);
        if (id) widest.set(id, Math.max(widest.get(id) ?? 1, seg.lines?.length ?? 1));
      }
      [...data.segments, ...data.stops].forEach((x) => ctx.extendRange(x.start, x.end));
      // A group's data starts at its coverage, so a map of today's network alone opens on today.
      data.groups.forEach((gd) => ctx.extendRange(gd.coverage?.from));
      ctx.provide("stop", (id) => {
        const s = stops.get(id);
        return s && ctx.lerp(s.g, s.s);
      });
    },

    onProject: project,

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
      // Zoomed out, a crowded group's bundles merge into one stroke; they fan out as the map zooms in.
      const fan = new Map(data.groups.map((gd) => [gd.id, spread(state.t.k, widest.get(gd.id) ?? 1, lineGap, bundleWidth)] as const));
      const ease = (t: number) => t * t * (3 - 2 * t);
      // Like a web map: as much detail as the zoom can show, simplified to half a pixel on screen.
      const level = Math.max(LEVELS[0], Math.min(LEVELS[1], Math.ceil(Math.log2(state.t.k))));
      const detailed = (s: Seg, which: 0 | 1) => {
        let pts = s.lod[which].get(level);
        if (!pts) s.lod[which].set(level, (pts = simplify(which ? s.sp : s.gp, 0.5 / 2 ** level)));
        return pts;
      };
      // The morph pairs points by index, so both layouts are resampled to one count, more when zoomed in.
      const paired = (s: Seg) => {
        let pair = s.morph.get(level);
        if (!pair) {
          const n = Math.min(samples * 2 ** Math.max(0, level), 512);
          s.morph.set(level, (pair = [resample(s.gp, n), resample(s.sp, n)]));
        }
        return pair;
      };

      // The layout at one end of a segment (0 = drawn start, 1 = end): its lines together with
      // those of the segment it chains into there, so a line running through keeps its place.
      const chained = (s: Seg, end: 0 | 1) => {
        const other = shown.get((end ? chain.next[s.i] : chain.prev[s.i]) ?? -1);
        return slots([...ids(shown.get(s.i)!.strands), ...ids(other?.strands ?? [])], order, gap);
      };
      // A branch at a junction chains into nothing; its lines start where they sit in the bundle
      // they leave, mirrored if that bundle is drawn the other way through the stop.
      const layout = (s: Seg, end: 0 | 1) => {
        if ((end ? chain.next[s.i] : chain.prev[s.i]) !== undefined) return chained(s, end);
        const stop = end ? s.to : s.from;
        const own = ids(shown.get(s.i)!.strands);
        let host: Seg | undefined, most = 0;
        for (const h of atStop.get(`${s.group.id} ${stop}`) ?? []) {
          const hs = shown.get(h.i);
          if (h === s || !hs) continue;
          const n = ids(hs.strands).filter((id) => own.includes(id)).length;
          if (n > most) { most = n; host = h; }
        }
        if (!host || most < own.length) return chained(s, end);
        const hostEnd = host.to === stop ? 1 : 0;
        const there = chained(host, hostEnd);
        const sign = hostEnd !== end ? 1 : -1;   // one arrives and one leaves: same sense
        return new Map(own.map((id) => [id, sign * there.get(id)!]));
      };

      // Mid-morph, both layouts need the same points; otherwise draw the real geometry.
      const paths = new Map<number, Point[]>();
      const pathOf = (s: Seg) => {
        let p = paths.get(s.i);
        if (!p) paths.set(s.i, (p = state.morph <= 0 ? detailed(s, 0) : state.morph >= 1 ? detailed(s, 1) : mix(...paired(s), state.morph)));
        return p;
      };
      // The point next to the joint on the segment chained at one end, for a mitre join there.
      const across = (s: Seg, end: 0 | 1): Point | undefined => {
        const other = shown.get((end ? chain.next[s.i] : chain.prev[s.i]) ?? -1)?.s;
        if (!other) return undefined;
        const p = pathOf(other);
        return end ? p[1] : p[p.length - 2];
      };

      // Strokes are collected by colour, width and opacity and drawn a path at a time: far fewer
      // canvas calls than one per line per segment. Merged strokes go underneath the separate lines.
      const under = new Map<string, Path2D>(), over = new Map<string, Path2D>();
      const add = (layer: Map<string, Path2D>, color: string, width: number, alpha: number, pts: Point[]) => {
        const key = `${color}|${width.toFixed(3)}|${alpha.toFixed(2)}`;
        let path = layer.get(key);
        if (!path) layer.set(key, (path = new Path2D()));
        pts.forEach(([x, y], k) => (k ? path!.lineTo(x, y) : path!.moveTo(x, y)));
      };
      // What is on screen, in map units, with room for the widest bundle.
      const pad = ctx.px(40);
      const view = [-state.t.x / state.t.k - pad, -state.t.y / state.t.k - pad,
        (state.width - state.t.x) / state.t.k + pad, (state.height - state.t.y) / state.t.k + pad];

      for (const { s, life, vis, strands } of shown.values()) {
        const [x0, y0, x1, y1] = s.box;
        if (x1 < view[0] || x0 > view[2] || y1 < view[1] || y0 > view[3]) continue;
        // Groups that fade in schematic view (the buses) are drawn thinner, so rail leads the eye.
        const base = ctx.px(lineWidth) * (s.group.schematic ? 1 : 0.6);
        const alpha = life.alpha * vis;
        const full = pathOf(s);
        const grown = (pts: Point[]) => (s.flipped ? cutAt(pts.reverse(), life.grow).reverse() : cutAt(pts, life.grow));
        // Lines that all share a colour cannot be told apart side by side: one stroke down the
        // middle, a little wider the more lines it carries.
        if (strands.every((l) => l.color === strands[0].color)) {
          const width = base * Math.min(2.2, 0.7 + 0.3 * Math.sqrt(strands.length));
          add(over, strands[0].color, width, alpha, grown([...full]));
        } else {
          // In between the two ends, each line eases from its place at one to its place at the other.
          const d0 = layout(s, 0), d1 = layout(s, 1);
          const before = across(s, 0), after = across(s, 1);
          const t = along(full);
          const f = fan.get(s.group.id) ?? 1;
          const ends = strands.map((l) => [(l.id && d0.get(l.id)) || 0, (l.id && d1.get(l.id)) || 0] as const);
          const shifted = (a: number, b: number) => grown(offset(full, (k) => f * (a + (b - a) * ease(t[k])), before, after));
          // Merged: one stroke down the middle in the group's colour, fading as the lines fan out.
          if (f < 1) {
            const mid = (j: 0 | 1) => ends.reduce((sum, e) => sum + e[j], 0) / ends.length;
            add(under, s.group.color, base, alpha * (1 - f), shifted(mid(0), mid(1)));
          }
          if (f > 0) strands.forEach((l, j) => add(over, l.color, base, alpha * f, shifted(ends[j][0], ends[j][1])));
        }
        if (alpha > 0.5) {
          const [head, tail] = s.flipped ? [s.to, s.from] : [s.from, s.to];
          touched.add(head);
          if (life.grow >= 1) touched.add(tail);
        }
      }
      for (const layer of [under, over]) {
        for (const [key, path] of layer) {
          const [color, width, alpha] = key.split("|");
          g.globalAlpha = Number(alpha);
          g.strokeStyle = color;
          g.lineWidth = Number(width);
          g.stroke(path);
        }
      }

      g.globalAlpha = 1;
      g.lineWidth = ctx.px(1.2);
      g.strokeStyle = "#222";
      g.font = `${ctx.px(11)}px system-ui, sans-serif`;
      // Zoomed out, only stops where something happens: a line ends, lines merge, split or cross,
      // or two of the groups on show meet. The others fade in as the map zooms in.
      const minor = clamp01((state.t.k - stopZoom[0]) / (stopZoom[1] - stopZoom[0]));
      const labelled = new Map<string, Point[]>();
      for (const id of touched) {
        const st = stops.get(id);
        if (!st) continue;
        const on = [...(groupsAt.get(id) ?? [])].filter((gid) => ctx.isOn(gid));
        const big = on.length > 1 || on.some((gid) => major.get(id)?.has(gid));
        const alpha = big ? 1 : minor;
        if (alpha <= 0) continue;
        g.globalAlpha = alpha;
        const [x, y] = ctx.lerp(st.g, st.s);
        g.fillStyle = "#fff";
        g.beginPath();
        g.arc(x, y, ctx.px(3), 0, 2 * Math.PI);
        g.fill();
        g.stroke();
        // A station split into platforms on crossing streets has one name: write it once.
        const twin = labelled.get(st.name)?.some(([lx, ly]) => Math.hypot(lx - x, ly - y) < ctx.px(80));
        if (!twin && state.t.k >= (big ? labelZoom : minorLabelZoom)) {
          g.fillStyle = "#333";
          g.fillText(st.name, x + ctx.px(5), y - ctx.px(4));
          labelled.set(st.name, [...(labelled.get(st.name) ?? []), [x, y]]);
        }
      }
      g.globalAlpha = 1;

      const gaps = data.groups
        .filter((gd) => ctx.isOn(gd.id) && gd.coverage?.from && state.year < (toYear(gd.coverage.from) ?? -Infinity))
        .map((gd) => `${gd.label}: data from ${String(gd.coverage?.from).slice(0, 4)}`);
      ctx.setBadge("coverage", gaps.join(" · "));
    },
  };
}
