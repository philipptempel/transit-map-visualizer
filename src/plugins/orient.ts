import type { Line, LonLat, Segment } from "../schema";

const lineIds = (s: Segment) => new Set((s.lines ?? []).map((l) => (typeof l === "string" ? l : l.id)));

export interface Orientation {
  flip: boolean[];                    // draw from `to` back to `from`
  prev: (number | undefined)[];       // the segment this one continues, at its drawn start
  next: (number | undefined)[];       // the segment that continues this one, at its drawn end
}

export interface OrientOptions {
  /** Line order across bundles (see lineOrder); with `geo`, chains turn so branches leave on their side. */
  order?: Map<string, number>;
  /** A segment's points from `from` to `to`, in lon/lat. */
  geo?: (i: number) => LonLat[];
}

/**
 * Which segments to draw reversed (from `to` back to `from`), so that parallel lines keep their
 * side from one segment to the next. Lines are offset sideways from the drawing direction, so
 * two consecutive segments drawn in opposite directions would swap their colours at the stop.
 *
 * At each stop, a segment continues into the neighbour it shares the most lines with (any
 * neighbour, if the stop joins just two), and the direction carries along these chains. Only
 * segments with the same `key` (the group they are drawn in) are chained; `undefined` skips one.
 *
 * Which way a whole chain runs is free, and it decides which side of the bundle each line takes.
 * Given `order` and `geo`, each chain is turned so that, at most of its junctions, the lines that
 * branch off already sit on the side their branch leaves to, rather than crossing the others.
 */
export function orient(segs: Segment[], key: (s: Segment) => string | undefined, opts: OrientOptions = {}): Orientation {
  const lines = segs.map(lineIds);
  const at = new Map<string, number[]>();   // group + stop → segments touching it
  segs.forEach((s, i) => {
    const k = key(s);
    if (k == null || s.from === s.to) return;
    for (const stop of [s.from, s.to]) {
      const id = JSON.stringify([k, stop]);
      at.set(id, [...(at.get(id) ?? []), i]);
    }
  });

  const links: [next: number, stop: string][][] = segs.map(() => []);
  const paired = new Map<string, [number, number]>();   // group + stop → the two segments chained there
  for (const [id, idx] of at) {
    const stop = (JSON.parse(id) as [string, string])[1];
    const pairs: [shared: number, a: number, b: number][] = [];
    for (let x = 0; x < idx.length; x++) {
      for (let y = x + 1; y < idx.length; y++) {
        let shared = 0;
        for (const l of lines[idx[x]]) if (lines[idx[y]].has(l)) shared++;
        if (shared || idx.length === 2) pairs.push([shared, idx[x], idx[y]]);
      }
    }
    pairs.sort((p, q) => q[0] - p[0] || p[1] - q[1] || p[2] - q[2]);
    const used = new Set<number>();
    for (const [, a, b] of pairs) {
      if (used.has(a) || used.has(b)) continue;
      used.add(a).add(b);
      links[a].push([b, stop]);
      links[b].push([a, stop]);
      if (!paired.has(id)) paired.set(id, [a, b]);
    }
  }

  const flip: (boolean | undefined)[] = segs.map(() => undefined);
  const chainOf: number[] = segs.map(() => -1);
  let chains = 0;
  for (let i = 0; i < segs.length; i++) {
    if (flip[i] !== undefined) continue;
    flip[i] = false;   // a chain starts the way its first segment is written
    chainOf[i] = chains;
    const queue = [i];
    while (queue.length) {
      const x = queue.pop()!;
      const end = flip[x] ? segs[x].from : segs[x].to;
      for (const [y, stop] of links[x]) {
        if (flip[y] !== undefined) continue;
        // Arriving at `stop`, the next segment leaves from it; leaving `stop`, the previous one arrives there.
        flip[y] = stop === end ? segs[y].from !== stop : segs[y].to !== stop;
        chainOf[y] = chains;
        queue.push(y);
      }
    }
    chains++;
  }

  if (opts.order && opts.geo) {
    const votes = new Array<number>(chains).fill(0);
    for (const [id, [a, c]] of paired) {
      const idx = at.get(id)!;
      if (idx.length < 3) continue;
      const stop = (JSON.parse(id) as [string, string])[1];
      // The bundle through the stop, in drawing order, and the direction it runs there.
      const bundle = slots([...lines[a], ...lines[c]], opts.order, 1);
      const dir = heading(opts.geo(a), segs[a].to === stop, !!flip[a]);
      for (const b of idx) {
        if (b === a || b === c) continue;
        const branching = [...lines[b]].filter((l) => bundle.has(l));
        if (!branching.length) continue;
        const side = branching.reduce((sum, l) => sum + bundle.get(l)!, 0) / branching.length;
        const pts = opts.geo(b), out = segs[b].from === stop ? pts : [...pts].reverse();
        const ray: LonLat = [out[1][0] - out[0][0], out[1][1] - out[0][1]];
        // Positive offsets lie to the right of the drawing direction, so a left turn wants negative ones.
        const turn = dir[0] * ray[1] - dir[1] * ray[0];
        if (side && turn) votes[chainOf[a]] += (side * turn < 0 ? 1 : -1) * branching.length;
      }
    }
    for (let i = 0; i < segs.length; i++) if (votes[chainOf[i]] < 0) flip[i] = !flip[i];
  }

  const flips = flip.map((f) => !!f);
  const neighbour = (x: number, end: boolean) => {
    const stop = flips[x] === end ? segs[x].from : segs[x].to;
    return links[x].find(([, at]) => at === stop)?.[0];
  };
  return { flip: flips, prev: segs.map((_, x) => neighbour(x, false)), next: segs.map((_, x) => neighbour(x, true)) };
}

/** The drawing direction of a segment at one of its stops (lon/lat, so north is +y). */
function heading(pts: LonLat[], atTo: boolean, flipped: boolean): LonLat {
  const [p, q] = atTo ? [pts[pts.length - 2], pts[pts.length - 1]] : [pts[0], pts[1]];
  const d: LonLat = [q[0] - p[0], q[1] - p[1]];   // the way the segment is written, from → to
  return flipped ? [-d[0], -d[1]] : d;
}

/**
 * Lines in the order they sit across a bundle. Lines that share most of their track sit side by
 * side, so where they branch off together they need not cross the others; otherwise by ref,
 * numbers compared as numbers (S2 before S11).
 */
export function lineOrder(lines: Line[], segments: Segment[] = []): Map<string, number> {
  const byRef = [...lines].sort((a, b) =>
    (a.ref ?? "").localeCompare(b.ref ?? "", "en", { numeric: true }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const count = new Map<string, number>();
  const shared = new Map<string, Map<string, number>>();
  for (const s of segments) {
    const ids = [...lineIds(s)];
    for (const x of ids) {
      count.set(x, (count.get(x) ?? 0) + 1);
      for (const y of ids) {
        if (x === y) continue;
        if (!shared.has(x)) shared.set(x, new Map());
        shared.get(x)!.set(y, (shared.get(x)!.get(y) ?? 0) + 1);
      }
    }
  }
  // Greedy: after each line, the unplaced one most alike (Jaccard on segments); none alike, the next by ref.
  const rank = new Map(byRef.map((l, i) => [l.id, i]));
  const placed = new Map<string, number>();
  let last: string | undefined;
  let cursor = 0;
  while (placed.size < byRef.length) {
    let pick: string | undefined, best = 0;
    for (const [y, n] of (last && shared.get(last)) || []) {
      if (placed.has(y)) continue;
      const j = n / ((count.get(last!) ?? 0) + (count.get(y) ?? 0) - n);
      if (j > best || (j === best && pick !== undefined && rank.get(y)! < rank.get(pick)!)) { best = j; pick = y; }
    }
    if (pick === undefined) {
      while (placed.has(byRef[cursor].id)) cursor++;
      pick = byRef[cursor].id;
    }
    placed.set(pick, placed.size);
    last = pick;
  }
  return placed;
}

/** Offsets across a bundle of these lines, centred, in `order`, `gap` apart. */
export function slots(ids: Iterable<string>, order: Map<string, number>, gap: number): Map<string, number> {
  const sorted = [...new Set(ids)].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || (a < b ? -1 : 1));
  return new Map(sorted.map((id, i) => [id, (i - (sorted.length - 1) / 2) * gap]));
}

/**
 * How far a group's bundles fan out at zoom `k`: 0 = drawn as one stroke, 1 = every line beside
 * the next. A bundle of `widest` lines may take `width` pixels at zoom 1; a group whose widest
 * bundle needs more starts to split at half the zoom where it fits, and is fully split there.
 */
export function spread(k: number, widest: number, gap: number, width: number): number {
  const fits = ((widest - 1) * gap) / width;   // the zoom at which the widest bundle fits
  if (fits <= 0) return 1;
  const t = Math.max(0, Math.min(1, (k - fits / 2) / (fits / 2)));
  return t * t * (3 - 2 * t);
}
