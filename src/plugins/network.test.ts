import { describe, expect, it } from "vitest";
import type { NetworkFile } from "../schema";
import { majorStops, trackPoints } from "./network";

const group = (id: string, modes: NetworkFile["groups"][number]["modes"], schematic = true) =>
  ({ id, label: id, modes, color: "#000", defaultOn: true, schematic });

describe("trackPoints", () => {
  // A station drawn at its building (x = 1), with three S-Bahn tracks ending on its platforms and a
  // bus stop round the corner, where two bus routes end.
  const net: NetworkFile = {
    groups: [group("s_bahn", ["s_bahn"]), group("bus", ["bus"], false)],
    lines: [],
    stops: [{ id: "st", name: "Station", geo: [1, 0] }, { id: "n", name: "N", geo: [0, 5] }, { id: "s", name: "S", geo: [0, -5] }],
    segments: [
      { from: "n", to: "st", mode: "s_bahn", geo: [[0, 5], [0, 0.1]] },
      { from: "st", to: "s", mode: "s_bahn", geo: [[0, 0], [0, -5]] },
      { from: "st", to: "s", mode: "s_bahn", geo: [[0.05, -0.2], [0, -5]] },
      { from: "n", to: "st", mode: "bus", geo: [[0, 5], [3, 3]] },
      { from: "st", to: "s", mode: "bus", geo: [[3, 3], [0, -5]] },
    ],
  };
  const at = trackPoints(net);

  it("draws a stop at the most central track end of its most prominent group", () => {
    expect(at.get("st")).toEqual([0, 0]);   // not the building at x = 1, not the bus stop at (3, 3)
  });
});

describe("majorStops", () => {
  // S1 runs a–b–c–d, S2 runs b–c and ends at c, S3 branches off at c to e; bus 7 passes through b.
  const net: NetworkFile = {
    groups: [group("s_bahn", ["s_bahn"]), group("bus", ["bus"], false)],
    lines: [], stops: [],
    segments: [
      { from: "a", to: "b", mode: "s_bahn", lines: ["S1"] },
      { from: "b", to: "c", mode: "s_bahn", lines: ["S1", "S2"] },
      { from: "c", to: "d", mode: "s_bahn", lines: ["S1"] },
      { from: "c", to: "e", mode: "s_bahn", lines: ["S3"] },
      { from: "x", to: "b", mode: "bus", lines: ["7"] },
      { from: "b", to: "y", mode: "bus", lines: ["7"] },
    ],
  };
  const major = majorStops(net);
  const has = (stop: string, g: string) => !!major.get(stop)?.has(g);

  it("keeps the ends of lines", () => {
    expect(has("a", "s_bahn")).toBe(true);    // S1 ends
    expect(has("d", "s_bahn")).toBe(true);
    expect(has("e", "s_bahn")).toBe(true);    // S3 ends
  });

  it("keeps stops where lines start, end, merge or split", () => {
    expect(has("b", "s_bahn")).toBe(true);    // S2 starts
    expect(has("c", "s_bahn")).toBe(true);    // S2 ends, S3 branches off
  });

  it("drops stops a line just passes through", () => {
    expect(has("b", "bus")).toBe(false);      // bus 7 passes b
    expect(major.has("y")).toBe(true);        // ...and ends at y
  });
});
