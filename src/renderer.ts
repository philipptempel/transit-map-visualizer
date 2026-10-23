import { geoMercator, type GeoProjection } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomTransform } from "d3-zoom";
import type { MultiPoint } from "geojson";
import type { CityEntry, DateLike, LonLat, ToggleGroup } from "./schema";

export type Point = [x: number, y: number];
export interface Life { grow: number; alpha: number }

/**
 * Things plugins share with each other. Extend it from a plugin file:
 *   declare module "../renderer" { interface Services { myThing: MyType } }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Services {}

export interface RenderState {
  year: number; morph: number; t: ZoomTransform;
  width: number; height: number; dpr: number; playing: boolean;
}

export interface Ctx {
  readonly g: CanvasRenderingContext2D;
  readonly city: CityEntry;
  readonly state: RenderState;
  readonly projection: GeoProjection;
  project(ll: LonLat): Point;
  lerp(a: Point, b: Point, m?: number): Point;
  life(start?: DateLike, end?: DateLike): Life;
  px(n: number): number;
  addGroup(def: ToggleGroup): void;
  isOn(id: string): boolean;
  extendRange(start?: DateLike, end?: DateLike): void;
  setBadge(id: string, text?: string | null): void;
  provide<K extends keyof Services>(name: K, value: Services[K]): void;
  use<K extends keyof Services>(name: K): Services[K] | undefined;
  redraw(): void;
}

export interface Plugin {
  id: string;
  order?: number;
  init?(ctx: Ctx): void | Promise<void>;
  onProject?(ctx: Ctx): void;
  draw?(ctx: Ctx): void;
}

export interface Snapshot { year: number; morph: number; playing: boolean; range: [number, number]; badges: string[] }

export interface RendererOptions {
  canvas: HTMLCanvasElement; city: CityEntry; plugins: Plugin[];
  yearsPerSecond?: number; rampYears?: number;
}

export interface Renderer {
  ready: Promise<void>;
  readonly state: Readonly<RenderState>;
  groups(): (ToggleGroup & { on: boolean })[];
  toggle(id: string, value?: boolean): void;
  setYear(year: number): void;
  play(): void;
  pause(): void;
  setMode(target: 0 | 1, ms?: number): void;
  onChange(cb: (s: Snapshot) => void): () => void;
}

function fail(msg: string): never { throw new Error(msg); }

export function toYear(d: DateLike): number | null {
  if (d == null || d === "") return null;
  if (typeof d === "number") return d;
  const [y, m = 1, day = 1] = d.split("-").map(Number);
  return y + ((m - 1) * 30.44 + (day - 1)) / 365.25;
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  return res.ok ? ((await res.json()) as T) : null;
}

export function resample(pts: Point[], n: number): Point[] {
  if (pts.length < 2) return Array.from({ length: n }, () => pts[0]);
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = acc[acc.length - 1] || 1;
  const out: Point[] = [];
  for (let k = 0, j = 1; k < n; k++) {
    const d = (k / (n - 1)) * total;
    while (j < pts.length - 1 && acc[j] < d) j++;
    const f = (d - acc[j - 1]) / (acc[j] - acc[j - 1] || 1);
    out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f]);
  }
  return out;
}

export function cutAt(pts: Point[], f: number): Point[] {
  if (f >= 1) return pts;
  const x = f * (pts.length - 1), i = Math.floor(x), r = x - i;
  const out = pts.slice(0, i + 1);
  if (i + 1 < pts.length) {
    out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r]);
  }
  return out;
}

export function offset(pts: Point[], d: number): Point[] {
  if (!d) return pts;
  return pts.map((p, i): Point => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / len) * d, p[1] + (dx / len) * d];
  });
}

export function createRenderer({
  canvas, city, plugins, yearsPerSecond = 4, rampYears = 0.75,
}: RendererOptions): Renderer {
  const g = canvas.getContext("2d") ?? fail("Canvas 2D context unavailable");
  const projection = geoMercator();
  const order = [...plugins].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const broken = new Set<Plugin>();
  const live = () => order.filter((p) => !broken.has(p));

  const state: RenderState = { year: 0, morph: 0, t: zoomIdentity, width: 0, height: 0, dpr: 1, playing: false };
  const groups = new Map<string, ToggleGroup>();
  const on = new Set<string>();
  const badges = new Map<string, string>();
  const services = new Map<PropertyKey, unknown>();
  const listeners = new Set<(s: Snapshot) => void>();
  const range: [number, number] = [Infinity, -Infinity];
  let frame = 0;

  const ctx: Ctx = {
    g, city, state, projection,
    project: (ll) => projection(ll) ?? [NaN, NaN],
    lerp: (a, b, m = state.morph) => [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m],
    life(start, end) {
      const s = toYear(start) ?? -Infinity, e = toYear(end) ?? Infinity;
      const grow = clamp01((state.year - s) / rampYears);
      return { grow, alpha: grow > 0 ? clamp01((e - state.year) / rampYears) : 0 };
    },
    px: (n) => n / state.t.k,
    addGroup(def) { groups.set(def.id, def); if (def.defaultOn) on.add(def.id); },
    isOn: (id) => on.has(id),
    extendRange(start, end) {
      const s = toYear(start), e = toYear(end);
      if (s != null) range[0] = Math.min(range[0], Math.floor(s));
      if (e != null) range[1] = Math.max(range[1], Math.ceil(e));
    },
    setBadge(id, text) { if (text) badges.set(id, text); else badges.delete(id); },
    provide<K extends keyof Services>(name: K, value: Services[K]) { services.set(name, value); },
    use<K extends keyof Services>(name: K) { return services.get(name) as Services[K] | undefined; },
    redraw: () => schedule(),
  };

  function schedule() { if (!frame) frame = requestAnimationFrame(draw); }

  function draw() {
    frame = 0;
    const { dpr, t, width, height } = state;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    for (const p of live()) {
      g.save();
      g.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);
      try { p.draw?.(ctx); } catch (err) { console.error(`[plugin ${p.id}] draw`, err); }
      g.restore();
    }
    const snap: Snapshot = {
      year: state.year, morph: state.morph, playing: state.playing,
      range: [range[0], range[1]], badges: [...badges.values()],
    };
    listeners.forEach((cb) => cb(snap));
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    state.dpr = window.devicePixelRatio || 1;
    state.width = r.width;
    state.height = r.height;
    canvas.width = Math.round(r.width * state.dpr);
    canvas.height = Math.round(r.height * state.dpr);
    const [w, s, e, n] = city.bbox;
    const extent: MultiPoint = { type: "MultiPoint", coordinates: [[w, s], [e, n]] };
    projection.fitExtent([[24, 24], [r.width - 24, r.height - 24]], extent);
    for (const p of live()) {
      try { p.onProject?.(ctx); } catch (err) { console.error(`[plugin ${p.id}] onProject`, err); }
    }
    schedule();
  }

  function play() {
    if (state.playing) return;
    if (state.year >= range[1]) state.year = range[0];
    state.playing = true;
    let last = 0;
    const step = (now: number) => {
      if (!state.playing) return;
      if (last) state.year = Math.min(range[1], state.year + ((now - last) / 1000) * yearsPerSecond);
      last = now;
      if (state.year >= range[1]) state.playing = false;
      draw();
      if (state.playing) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function setMode(target: 0 | 1, ms = 800) {
    const from = state.morph, t0 = performance.now();
    const step = (now: number) => {
      const k = clamp01((now - t0) / ms);
      const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      state.morph = from + (target - from) * eased;
      draw();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const ready = (async () => {
    for (const p of order) {
      try { await p.init?.(ctx); } catch (err) { console.error(`[plugin ${p.id}] init`, err); broken.add(p); }
    }
    if (!Number.isFinite(range[0])) range[0] = 1900;
    range[1] = Math.max(range[1], new Date().getFullYear());
    state.year = range[0];
    select(canvas).call(
      zoom<HTMLCanvasElement, unknown>()
        .scaleExtent([0.5, 50])
        .on("zoom", (e: D3ZoomEvent<HTMLCanvasElement, unknown>) => { state.t = e.transform; schedule(); }),
    );
    new ResizeObserver(resize).observe(canvas);
  })();

  return {
    ready,
    state,
    groups: () => [...groups.values()].map((d) => ({ ...d, on: on.has(d.id) })),
    toggle(id, value = !on.has(id)) { if (value) on.add(id); else on.delete(id); schedule(); },
    setYear(year) { state.playing = false; state.year = year; schedule(); },
    play,
    pause() { state.playing = false; schedule(); },
    setMode,
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
}
