import { describe, expect, it } from "vitest";
import type { LonLat, Segment } from "../schema";
import { lineOrder, orient, slots, spread } from "./orient";

const seg = (from: string, to: string, lines: string[], mode: Segment["mode"] = "s_bahn"): Segment => ({ from, to, mode, lines });
const byMode = (s: Segment) => s.mode;

/** The stops in drawing order, to see that each segment starts where the last one ended. */
const drawn = (segs: Segment[], flip: boolean[]) => segs.map((s, i) => (flip[i] ? [s.to, s.from] : [s.from, s.to]));

describe("orient", () => {
  it("keeps one direction along a line whatever order the stop ids sort in", () => {
    // "n2" > "n10" < "n3" > "n11" as strings: comparing ids flipped every other segment.
    const segs = [seg("n2", "n10", ["S1", "S2"]), seg("n10", "n3", ["S1", "S2"]), seg("n3", "n11", ["S1", "S2"])];
    expect(drawn(segs, orient(segs, byMode).flip)).toEqual([["n2", "n10"], ["n10", "n3"], ["n3", "n11"]]);
  });

  it("turns segments written against the flow of their neighbours", () => {
    const segs = [seg("a", "b", ["S1"]), seg("c", "b", ["S1"]), seg("c", "d", ["S1"]), seg("e", "d", ["S1"])];
    expect(drawn(segs, orient(segs, byMode).flip)).toEqual([["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"]]);
  });

  it("follows the branch that shares the most lines through a junction", () => {
    const segs = [seg("a", "b", ["S1", "S2", "S3"]), seg("d", "b", ["S3"]), seg("c", "b", ["S1", "S2"])];
    const { flip } = orient(segs, byMode);
    expect(drawn(segs, flip)[0]).toEqual(["a", "b"]);
    expect(drawn(segs, flip)[2]).toEqual(["b", "c"]);
  });

  it("joins two segments at a stop even when they share no line", () => {
    const segs = [seg("a", "b", ["U1"]), seg("c", "b", ["U2"])];
    expect(drawn(segs, orient(segs, byMode).flip)).toEqual([["a", "b"], ["b", "c"]]);
  });

  it("chains only segments of the same group", () => {
    const segs = [seg("a", "b", ["1"], "bus"), seg("c", "b", ["1"], "tram")];
    expect(orient(segs, byMode).flip).toEqual([false, false]);
    expect(orient(segs, () => undefined).flip).toEqual([false, false]);
  });

  it("survives a loop", () => {
    const segs = [seg("a", "b", ["R"]), seg("b", "c", ["R"]), seg("c", "a", ["R"])];
    expect(drawn(segs, orient(segs, byMode).flip)).toEqual([["a", "b"], ["b", "c"], ["c", "a"]]);
  });
});

describe("chained neighbours", () => {
  it("names the segment before and after each one, in drawing order", () => {
    const segs = [seg("a", "b", ["S1"]), seg("c", "b", ["S1"]), seg("c", "d", ["S1"])];
    const { prev, next } = orient(segs, byMode);
    expect(prev).toEqual([undefined, 0, 1]);
    expect(next).toEqual([1, 2, undefined]);
  });
});

describe("bundle layout", () => {
  const order = lineOrder([
    { id: "r9", ref: "S11", mode: "s_bahn" }, { id: "r3", ref: "S2", mode: "s_bahn" },
    { id: "r5", ref: "S1", mode: "s_bahn" }, { id: "r1", mode: "s_bahn" },
  ]);

  it("orders lines by ref, numbers as numbers", () => {
    expect([...order.keys()]).toEqual(["r1", "r5", "r3", "r9"]);   // no ref first, then S1, S2, S11
  });

  it("centres the bundle, in that order", () => {
    expect([...slots(["r9", "r5", "r3"], order, 2)]).toEqual([["r5", -2], ["r3", 0], ["r9", 2]]);
  });

  it("keeps a through line's place at a stop where another line ends", () => {
    // S1, S2 and S11 arrive; S11 ends here, so the next segment carries only S1 and S2.
    const arriving = ["r5", "r3", "r9"], leaving = ["r5", "r3"];
    const atStop = slots([...arriving, ...leaving], order, 2);   // both sides lay out the union
    expect(atStop.get("r5")).toBe(slots(arriving, order, 2).get("r5"));
    expect(atStop.get("r3")).toBe(slots(arriving, order, 2).get("r3"));
    // Away from the stop, S1 and S2 centre on their own.
    expect([...slots(leaving, order, 2)]).toEqual([["r5", -1], ["r3", 1]]);
  });
});

describe("spread", () => {
  // Ten lines 3.5 px apart need 31.5 px; at 10 px per bundle they fit from zoom 3.15.
  it("merges a crowded group when zoomed out and fans it out as the map zooms in", () => {
    expect(spread(1, 10, 3.5, 10)).toBe(0);
    expect(spread(1.575, 10, 3.5, 10)).toBe(0);
    expect(spread(2.3625, 10, 3.5, 10)).toBeCloseTo(0.5, 9);
    expect(spread(3.15, 10, 3.5, 10)).toBe(1);
    expect(spread(20, 10, 3.5, 10)).toBe(1);
  });

  it("keeps a group with small bundles split at normal zoom", () => {
    expect(spread(1, 3, 3.5, 10)).toBe(1);        // 7 px fits from zoom 0.7
    expect(spread(0.5, 3, 3.5, 10)).toBeLessThan(1);
    expect(spread(0.5, 1, 3.5, 10)).toBe(1);      // a single line never merges
  });

  it("only ever widens as the map zooms in", () => {
    const ks = Array.from({ length: 100 }, (_, i) => 0.5 + i * 0.1);
    const fs = ks.map((k) => spread(k, 12, 3.5, 10));
    expect(fs.every((f, i) => i === 0 || f >= fs[i - 1])).toBe(true);
  });
});

describe("junctions", () => {
  // Stuttgart Rohr in miniature: S1, S2, S3 and S11 arrive from the north; S2 and S3 leave one way,
  // S1 and S11 the other.
  const lines = [
    { id: "s1", ref: "S1", mode: "s_bahn" as const }, { id: "s2", ref: "S2", mode: "s_bahn" as const },
    { id: "s3", ref: "S3", mode: "s_bahn" as const }, { id: "s11", ref: "S11", mode: "s_bahn" as const },
  ];
  const at: Record<string, LonLat> = { v: [0, 1], r: [0, 0], east: [1, -1], west: [-1, -1] };
  const network = (s1Goes: "east" | "west") => {
    const other = s1Goes === "east" ? "west" : "east";
    return [
      seg("v", "r", ["s1", "s2", "s3", "s11"]),
      seg("r", other, ["s2", "s3"]),
      seg("r", s1Goes, ["s1", "s11"]),
    ];
  };

  it("puts lines that share their track side by side", () => {
    const order = lineOrder(lines, network("west"));
    expect([...order.keys()]).toEqual(["s1", "s11", "s2", "s3"]);   // not S1, S2, S3, S11
  });

  it("turns a chain so the lines that branch off sit on the side they leave to", () => {
    for (const s1Goes of ["east", "west"] as const) {
      const segs = network(s1Goes);
      const order = lineOrder(lines, segs);
      const { flip } = orient(segs, byMode, { order, geo: (i) => [at[segs[i].from], at[segs[i].to]] });
      // Positive offsets lie to the right of the drawing direction. Drawn southwards, right is west.
      const southwards = !flip[0];
      const s1Side = slots(["s1", "s11", "s2", "s3"], order, 1).get("s1")! > 0 === southwards ? "west" : "east";
      expect(s1Side).toBe(s1Goes);
    }
  });
});
