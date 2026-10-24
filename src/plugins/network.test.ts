import { describe, expect, it } from "vitest";
import type { NetworkFile } from "../schema";
import { trackPoints } from "./network";

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
  const { dot, end } = trackPoints(net);

  it("ends a group's segments at the most central of their track ends", () => {
    expect(end.get("s_bahn st")).toEqual([0, 0]);
    expect(end.get("bus st")).toEqual([3, 3]);
  });

  it("draws the stop on its rail track, not at the building or the bus stop", () => {
    expect(dot.get("st")).toEqual([0, 0]);
  });
});
