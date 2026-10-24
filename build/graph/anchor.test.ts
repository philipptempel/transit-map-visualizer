import { describe, expect, it } from "vitest";
import type { LonLat, Segment } from "../../src/schema";
import { anchorStops, snapEnds } from "./anchor";

describe("anchorStops", () => {
  // 0.001° is about 111 m. Three S-Bahn tracks end at a station; two bus routes end round the corner.
  const segs: Segment[] = [
    { from: "n", to: "st", mode: "s_bahn", geo: [[0, 0.05], [0, 0.0001]] },
    { from: "st", to: "s", mode: "s_bahn", geo: [[0, 0], [0, -0.05]] },
    { from: "st", to: "s", mode: "s_bahn", geo: [[0.0005, -0.002], [0, -0.05]] },
    { from: "n", to: "st", mode: "bus", geo: [[0, 0.05], [0.003, 0.003]] },
    { from: "st", to: "s", mode: "bus", geo: [[0.003, 0.003], [0, -0.05]] },
  ];
  const rank = (m: Segment["mode"]) => (m === "bus" ? 1 : 0);

  it("takes the most central track end of the most prominent mode", () => {
    expect(anchorStops(segs, rank).get("st")).toEqual([0, 0]);
  });

  it("falls back to the buses where no rail ends", () => {
    expect(anchorStops(segs.slice(3), rank).get("st")).toEqual([0.003, 0.003]);
  });
});

describe("snapEnds", () => {
  it("moves the ends and drops track points behind the new end", () => {
    // The old end is 100 m short of the new one; the point at 50 m lies between them and goes.
    const track: LonLat[] = [[0, 0], [0, 0.00045], [0, 0.01], [0, 0.02]];
    expect(snapEnds(track, [0, 0.0009], [0, 0.02])).toEqual([[0, 0.0009], [0, 0.01], [0, 0.02]]);
  });

  it("keeps a two-point track two points long", () => {
    expect(snapEnds([[0, 0], [1, 1]], [0, 0.001], [1, 1.001])).toEqual([[0, 0.001], [1, 1.001]]);
  });
});
