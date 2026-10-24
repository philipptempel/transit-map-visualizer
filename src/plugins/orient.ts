import type { Line, Segment } from "../schema";

const lineIds = (s: Segment) => new Set((s.lines ?? []).map((l) => (typeof l === "string" ? l : l.id)));

export interface Orientation {
  flip: boolean[];                    // draw from `to` back to `from`
  prev: (number | undefined)[];       // the segment this one continues, at its drawn start
  next: (number | undefined)[];       // the segment that continues this one, at its drawn end
}

/**
 * Which segments to draw reversed (from `to` back to `from`), so that parallel lines keep their
 * side from one segment to the next. Lines are offset to the left of the drawing direction, so
 * two consecutive segments drawn in opposite directions would swap their colours at the stop.
 *
 * At each stop, a segment continues into the neighbour it shares the most lines with (any
 * neighbour, if the stop joins just two), and the direction carries along these chains. Only
 * segments with the same `key` (the group they are drawn in) are chained; `undefined` skips one.
 */
export function orient(segs: Segment[], key: (s: Segment) => string | undefined): Orientation {
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
    }
  }

  const flip: (boolean | undefined)[] = segs.map(() => undefined);
  for (let i = 0; i < segs.length; i++) {
    if (flip[i] !== undefined) continue;
    flip[i] = false;   // a chain starts the way its first segment is written
    const queue = [i];
    while (queue.length) {
      const x = queue.pop()!;
      const end = flip[x] ? segs[x].from : segs[x].to;
      for (const [y, stop] of links[x]) {
        if (flip[y] !== undefined) continue;
        // Arriving at `stop`, the next segment leaves from it; leaving `stop`, the previous one arrives there.
        flip[y] = stop === end ? segs[y].from !== stop : segs[y].to !== stop;
        queue.push(y);
      }
    }
  }
  const flips = flip.map((f) => !!f);
  const neighbour = (x: number, end: boolean) => {
    const stop = flips[x] === end ? segs[x].from : segs[x].to;
    return links[x].find(([, at]) => at === stop)?.[0];
  };
  return { flip: flips, prev: segs.map((_, x) => neighbour(x, false)), next: segs.map((_, x) => neighbour(x, true)) };
}

/** Lines in the order they sit across a bundle: by ref, numbers compared as numbers (S2 before S11). */
export function lineOrder(lines: Line[]): Map<string, number> {
  const sorted = [...lines].sort((a, b) =>
    (a.ref ?? "").localeCompare(b.ref ?? "", "en", { numeric: true }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(sorted.map((l, i) => [l.id, i]));
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
