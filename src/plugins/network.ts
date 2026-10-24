import { cutAt, getJson, offset, resample, toYear, type Life, type Plugin, type Point } from "../renderer";
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
  group: GroupDef; lines: Strand[]; ga: Point[]; sa: Point[];
}

export interface NetworkOptions {
  url: string; samples?: number; lineWidth?: number; lineGap?: number; labelZoom?: number;
  /** Pixels a bundle of parallel lines may take at zoom 1; wider ones merge into one stroke until zoomed in. */
  bundleWidth?: number;
}

const mix = (a: Point[], b: Point[], m: number): Point[] =>
  a.map((p, i): Point => [p[0] + (b[i][0] - p[0]) * m, p[1] + (b[i][1] - p[1]) * m]);

export interface TrackPoints {
  dot: Map<string, LonLat>;    // stop → where to draw it
  end: Map<string, LonLat>;    // "group stop" → where that group's segments end at the stop
}

/**
 * Each route's track starts where that route stops, so at a big station the segments' ends lie on
 * different platforms, and the stop itself (often the station building) may be off the track.
 * Within each group, a stop's segments all end at the most central of their track ends; the stop
 * is drawn at that point of its most prominent group (groups that fade in schematic view, the
 * buses, count least), so a bus stop round the corner does not pull a station off its tracks.
 */
export function trackPoints({ groups, segments }: NetworkFile): TrackPoints {
  const rank = new Map<string, number>();
  const sorted = [...groups].sort((a, b) => Number(!a.schematic) - Number(!b.schematic));
  sorted.forEach((g, i) => g.modes.forEach((m) => { if (!rank.has(m)) rank.set(m, i); }));
  const groupOf = new Map(sorted.flatMap((g) => g.modes.map((m) => [m, g.id] as const)));

  const ends = new Map<string, LonLat[]>();
  const best = new Map<string, [rank: number, key: string]>();   // stop → its most prominent group's key
  for (const s of segments) {
    const g = groupOf.get(s.mode);
    if (!g || !s.geo || s.geo.length < 2) continue;
    for (const [stop, p] of [[s.from, s.geo[0]], [s.to, s.geo[s.geo.length - 1]]] as const) {
      const key = `${g} ${stop}`;
      ends.set(key, [...(ends.get(key) ?? []), p]);
      const r = rank.get(s.mode)!;
      if (!best.has(stop) || r < best.get(stop)![0]) best.set(stop, [r, key]);
    }
  }
  const end = new Map<string, LonLat>();
  for (const [key, pts] of ends) {
    let pick = pts[0], least = Infinity;
    for (const p of pts) {
      const sum = pts.reduce((t, q) => t + Math.hypot(p[0] - q[0], p[1] - q[1]), 0);
      if (sum < least) { least = sum; pick = p; }
    }
    end.set(key, pick);
  }
  const dot = new Map([...best].map(([stop, [, key]]) => [stop, end.get(key)!] as const));
  return { dot, end };
}

export function network({ url, samples = 24, lineWidth = 3, lineGap = 3.5, labelZoom = 2.5, bundleWidth = 10 }: NetworkOptions): Plugin {
  let data: NetworkFile = { groups: [], lines: [], stops: [], segments: [] };
  let segs: Seg[] = [];
  let stops = new Map<string, ProjectedStop>();
  let atStop = new Map<string, Seg[]>();   // group + stop → segments ending there
  let onTrack: TrackPoints = { dot: new Map(), end: new Map() };   // where stops and segment ends go
  let chain: Orientation = { flip: [], prev: [], next: [] };
  let order = new Map<string, number>();
  let widest = new Map<string, number>();   // group id → most lines on one of its segments

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
      order = lineOrder(data.lines, data.segments);
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

    onProject(ctx) {
      const P = ctx.project;
      const groupOf = new Map(data.groups.flatMap((gd) => gd.modes.map((m) => [m, gd] as const)));
      const lineById = new Map(data.lines.map((l) => [l.id, l] as const));
      stops = new Map(data.stops.map((s) => [s.id, { ...s, g: P(onTrack.dot.get(s.id) ?? s.geo), s: P(s.schem ?? s.geo) }] as const));

      segs = data.segments.flatMap((raw, i): Seg[] => {
        const group = groupOf.get(raw.mode), a = stops.get(raw.from), b = stops.get(raw.to);
        if (!group || !a || !b) return [];
        let { from, to } = raw;
        // Every segment meets the others where its stop is drawn (see trackPoints).
        const ga = onTrack.end.get(`${group.id} ${raw.from}`) ?? a.geo, gb = onTrack.end.get(`${group.id} ${raw.to}`) ?? b.geo;
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
          ga: resample(geo.map(P), samples),
          sa: resample(sch.map(P), samples),
        }];
      });
      atStop = new Map();
      for (const sg of segs) {
        for (const st of [sg.from, sg.to]) {
          const k = `${sg.group.id} ${st}`;
          atStop.set(k, [...(atStop.get(k) ?? []), sg]);
        }
      }
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
      // Zoomed out, a crowded group's bundles merge into one stroke; they fan out as the map zooms in.
      const fan = new Map(data.groups.map((gd) => [gd.id, spread(state.t.k, widest.get(gd.id) ?? 1, lineGap, bundleWidth)] as const));
      const ease = (t: number) => t * t * (3 - 2 * t);

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

      for (const { s, life, vis, strands } of shown.values()) {
        // In between the two ends, each line eases from its place at one to its place at the other.
        const d0 = layout(s, 0), d1 = layout(s, 1);
        const full = mix(s.ga, s.sa, state.morph);
        const last = full.length - 1;
        const f = fan.get(s.group.id) ?? 1;
        const ends = strands.map((l) => [(l.id && d0.get(l.id)) || 0, (l.id && d1.get(l.id)) || 0] as const);
        const stroke = (color: string, a: number, b: number, alpha: number) => {
          const pts = offset(full, (k) => f * (a + (b - a) * ease(k / last)));
          // Grow from the segment's own `from`; cut a flipped one from the far end and turn it back.
          const path = s.flipped ? cutAt(pts.reverse(), life.grow).reverse() : cutAt(pts, life.grow);
          g.globalAlpha = alpha;
          g.strokeStyle = color;
          g.beginPath();
          path.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.stroke();
        };
        // Merged: one stroke down the middle, in the lines' colour if they share one. It fades as they fan out.
        if (f < 1 && strands.length > 1) {
          const color = strands.every((l) => l.color === strands[0].color) ? strands[0].color : s.group.color;
          const mid = (j: 0 | 1) => ends.reduce((sum, e) => sum + e[j], 0) / ends.length;
          stroke(color, mid(0), mid(1), life.alpha * vis * (1 - f));
        }
        const each = strands.length > 1 ? f : 1;
        if (each > 0) strands.forEach((l, j) => stroke(l.color, ends[j][0], ends[j][1], life.alpha * vis * each));
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
