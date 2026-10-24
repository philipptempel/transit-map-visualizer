import { describe, expect, it } from "vitest";
import type { LonLat } from "../../src/schema";
import { demostadt } from "../__fixtures__/load";
import { classify } from "../classify";
import type { MapConfig } from "../config";
import { routes, stopCandidates } from "../sources/osm";
import { buildSegments, joinWays, type RouteForGraph } from "./segments";
import { dedupeStops } from "./stops";

const cfg: MapConfig = {
  id: "demo", name: "Demo", scope: "city", network: "transit",
  bbox: [0, 0.02, 0.3, 0.28], clip: "bbox", profile: "local", sBahnLike: [{ ref: /^S\d+$/ }],
};

describe("joinWays", () => {
  it("flips ways so they meet end to end", () => {
    const a: LonLat[] = [[0, 0], [1, 0]], b: LonLat[] = [[2, 0], [1, 0]], c: LonLat[] = [[2, 0], [3, 0]];
    expect(joinWays([a, b, c])).toEqual([[[0, 0], [1, 0], [2, 0], [3, 0]]]);
  });

  it("flips the first way when only its start meets the second", () => {
    expect(joinWays([[[1, 0], [0, 0]], [[1, 0], [2, 0]]])).toEqual([[[0, 0], [1, 0], [2, 0]]]);
  });

  it("starts a new piece at a gap", () => {
    expect(joinWays([[[0, 0], [1, 0]], [[5, 0], [6, 0]]])).toHaveLength(2);
  });
});

describe("buildSegments", () => {
  const osm = demostadt();
  const rs = routes(osm);
  const { stopOf } = dedupeStops(stopCandidates(osm, rs));
  const pos = (id: string): LonLat => { const n = osm.nodes.get(Number(id.slice(1)))!; return [n.lon, n.lat]; };
  const forGraph: RouteForGraph[] = rs.map((r) => ({
    line: r.master ?? r.id,
    mode: classify(r.info, cfg)!,
    stops: r.stops.map((s) => ({ stop: stopOf.get(s)!, geo: pos(s) })),
    path: r.path,
  }));
  const segs = buildSegments(forGraph);

  it("makes one segment per stop pair and mode, shared by both directions", () => {
    expect(segs.map((s) => [s.mode, s.from, s.to, s.lines])).toEqual([
      ["tram", "r100", "n3", ["r10"]],
      ["tram", "n3", "n5", ["r10"]],
      ["tram", "n5", "n8", ["r10"]],
      ["express_bus", "n5", "n8", ["r3"]],
      ["s_bahn", "r100", "n7", ["r4"]],
    ]);
  });

  it("cuts each segment's geometry from the track, without doubled points", () => {
    expect(segs[0].geo).toEqual([[0.028, 0.128], [0.06, 0.13], [0.095, 0.142]]);
    expect(segs[1].geo).toEqual([[0.095, 0.142], [0.13, 0.148], [0.168, 0.15]]);   // way drawn backwards
    expect(segs[2].geo).toEqual([[0.168, 0.15], [0.19, 0.16], [0.212, 0.172]]);
  });

  it("starts a platform-only route where the platform projects onto the track", () => {
    const g = segs[3].geo!;
    expect(g).toHaveLength(3);
    expect(g[0][0]).toBeGreaterThan(0.168);
    expect(g.slice(1)).toEqual([[0.19, 0.16], [0.212, 0.172]]);
  });

  it("leaves a segment straight when there is no track, or a stop is far from it", () => {
    expect(segs[4].geo).toBeUndefined();
    const far = buildSegments([{
      line: "x", mode: "bus", path: [[[0, 0], [0.01, 0]]],
      stops: [{ stop: "a", geo: [0, 0] }, { stop: "b", geo: [0.01, 0.01] }],   // b is 1.1 km off
    }]);
    expect(far[0].geo).toBeUndefined();
  });

  it("adds lines from later routes and keeps the first route's direction", () => {
    const two = buildSegments([
      { line: "b", mode: "tram", path: [], stops: [{ stop: "x", geo: [0, 0] }, { stop: "y", geo: [0, 1] }] },
      { line: "a", mode: "tram", path: [], stops: [{ stop: "y", geo: [0, 1] }, { stop: "x", geo: [0, 0] }] },
    ]);
    expect(two).toEqual([{ from: "x", to: "y", mode: "tram", lines: ["a", "b"] }]);
  });
});
