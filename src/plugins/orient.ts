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
      // The bundle through the stop, in drawing order. Where branches go is judged by where they end
      // up (their far ends), not their first metres: lines often run side by side before parting.
      const bundle = slots([...lines[a], ...lines[c]], opts.order, 1);
      const far = (i: number): LonLat => {
        const pts = opts.geo!(i), p = segs[i].from === stop ? pts[pts.length - 1] : pts[0];
        const x = segs[i].from === stop ? pts[0] : pts[pts.length - 1];
        return [p[0] - x[0], p[1] - x[1]];
      };
      for (const b of idx) {
        if (b === a || b === c) continue;
        const branching = [...lines[b]].filter((l) => bundle.has(l));
        if (!branching.length) continue;
        const side = branching.reduce((sum, l) => sum + bundle.get(l)!, 0) / branching.length;
        // The pair member carrying b's lines is the host; b parts from the other one.
        const inA = branching.filter((l) => lines[a].has(l)).length, inC = branching.filter((l) => lines[c].has(l)).length;
        const [host, other] = inA >= inC ? [a, c] : [c, a];
        const vo = far(other), vb = far(b);
        const left = vo[0] * vb[1] - vo[1] * vb[0];   // > 0: b lies to the left of other, seen from the stop
        // Arriving along the host, left is left of travel; leaving along it, travel faces the other way.
        // Positive offsets lie to the right of the drawing direction, so a left turn wants negative ones.
        const hostArrives = (flip[host] ? segs[host].from : segs[host].to) === stop;
        const turn = hostArrives ? left : -left;
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

/**
 * Lines in the order they sit across a bundle, so that where lines part, the ones that leave
 * together sit together and need not cross the others.
 *
 * At every stop, for every two segments that share some lines, those shared lines should be
 * adjacent within the other segment's bundle (at Vaihinger Straße, U3, U8 and U12 leave together,
 * so they should not have U5 between them). The order starts from a greedy chain of lines that are
 * alike (Jaccard on their segments; otherwise by ref, S2 before S11) and is then improved by moving
 * lines and short runs of lines around while that satisfies more of those conditions, for groups
 * of up to `maxSearch` lines that share track (larger ones, the buses, keep the greedy order).
 */
export function lineOrder(
  lines: Line[], segments: Segment[] = [], key: (s: Segment) => string | undefined = () => "", maxSearch = 60,
): Map<string, number> {
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
  // Greedy: after each line, the unplaced one most alike; none alike, the next by ref.
  const rank = new Map(byRef.map((l, i) => [l.id, i]));
  const greedy: string[] = [];
  const placed = new Set<string>();
  let last: string | undefined;
  let cursor = 0;
  while (greedy.length < byRef.length) {
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
    greedy.push(pick);
    placed.add(pick);
    last = pick;
  }

  // The conditions: [bundle, the lines in it that should sit together].
  const at = new Map<string, Set<string>[]>();
  for (const s of segments) {
    const k = key(s), ids = lineIds(s);
    if (k == null || ids.size < 1) continue;
    for (const stop of [s.from, s.to]) {
      const id = JSON.stringify([k, stop]);
      at.set(id, [...(at.get(id) ?? []), ids]);
    }
  }
  const seen = new Set<string>();
  const rules: [bundle: string[], together: Set<string>][] = [];
  for (const sets of at.values()) {
    for (const t of sets) {
      for (const u of sets) {
        if (t === u) continue;
        const both = [...t].filter((l) => u.has(l));
        if (both.length < 2 || both.length === t.size) continue;   // nothing to keep together
        const id = `${[...t].sort().join(",")}|${both.sort().join(",")}`;
        if (seen.has(id)) continue;
        seen.add(id);
        rules.push([[...t], new Set(both)]);
      }
    }
  }

  // Groups of lines that share track; each is ordered on its own.
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  for (const s of segments) {
    const ids = [...lineIds(s)];
    for (const x of ids.slice(1)) parent.set(find(x), find(ids[0]));
  }
  const groups = new Map<string, string[]>();
  for (const id of greedy) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);

  const order = [...greedy];
  for (const members of groups.values()) {
    if (members.length < 3 || members.length > maxSearch) continue;
    const mine = new Set(members);
    const relevant = rules.filter(([bundle]) => mine.has(bundle[0]));
    if (!relevant.length) continue;
    const score = (seq: string[]) => {
      const pos = new Map(seq.map((id, i) => [id, i]));
      let ok = 0;
      for (const [bundle, together] of relevant) {
        const sorted = [...bundle].sort((x, y) => pos.get(x)! - pos.get(y)!);
        const idx = sorted.flatMap((id, i) => (together.has(id) ? [i] : []));
        if (idx[idx.length - 1] - idx[0] === idx.length - 1) ok++;
      }
      return ok;
    };
    // A seeded random walk over block moves that never gets worse, so it can cross plateaus that
    // single strict improvements cannot; the same data always gives the same order.
    let seed = 0x9e3779b9 ^ members.length;
    const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let seq = [...members], now = score(seq), best = seq, top = now;
    for (let step = 0; step < 400 * members.length && top < relevant.length; step++) {
      const len = 1 + Math.floor(rnd() * Math.min(3, seq.length - 1));
      const from = Math.floor(rnd() * (seq.length - len + 1));
      const rest = [...seq.slice(0, from), ...seq.slice(from + len)];
      const to = Math.floor(rnd() * (rest.length + 1));
      const next = [...rest.slice(0, to), ...seq.slice(from, from + len), ...rest.slice(to)];
      const sc = score(next);
      if (sc < now) continue;
      seq = next; now = sc;
      if (sc > top) { best = next; top = sc; }
    }
    seq = best;
    // Put the improved order back into the slots these lines held.
    const slotsHeld = members.map((id) => order.indexOf(id)).sort((x, y) => x - y);
    slotsHeld.forEach((slot, k) => { order[slot] = seq[k]; });
  }
  return new Map(order.map((id, i) => [id, i]));
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
