import { describe, expect, it } from "vitest";
import { demostadt } from "../__fixtures__/load";
import { checkNetwork } from "../check";
import type { MapConfig } from "../config";
import { buildNetwork, colour, formatNetwork, routesQuery } from "./network";

const cfg: MapConfig = {
  id: "demo", name: "Demo", scope: "city", network: "transit",
  bbox: [0, 0.02, 0.3, 0.28], clip: "bbox", profile: "local", sBahnLike: [{ ref: /^S\d+$/ }],
};

describe("buildNetwork", () => {
  const { file, report } = buildNetwork(demostadt(), cfg, 2026);

  it("makes one line per route_master, or per lone route", () => {
    expect(file.lines).toEqual([
      { id: "r3", mode: "express_bus", ref: "X3", name: "Bus X3: Markt => Dom", color: "#d85a30" },
      { id: "r4", mode: "s_bahn", ref: "S1", name: "S1" },
      { id: "r10", mode: "tram", ref: "1", name: "Tram 1", color: "#7f77dd" },
    ]);
  });

  it("keeps only the stops segments use, rounded", () => {
    expect(file.stops.map((s) => s.id)).toEqual(["n3", "n5", "n7", "n8", "r100"]);
    expect(file.stops.find((s) => s.id === "r100")).toEqual({ id: "r100", name: "Westpark", geo: [0.0283, 0.1284] });
  });

  it("lists only groups that occur, with coverage from the data's year and no dates", () => {
    expect(file.groups.map((g) => [g.id, g.coverage])).toEqual([
      ["tram", { from: "2026" }], ["s_bahn", { from: "2026" }], ["express_bus", { from: "2026" }],
    ]);
    expect(file.segments.every((s) => s.start === undefined && s.end === undefined)).toBe(true);
  });

  it("passes check-data", () => {
    expect(checkNetwork(file, { bounds: cfg.bbox })).toEqual([]);
    expect(report[0]).toBe("routes: 4 kept");
  });

  it("drops what the profile leaves out", () => {
    const { file: noBus, report: r } = buildNetwork(demostadt(), { ...cfg, include: { express_bus: false } }, 2026);
    expect(noBus.lines.map((l) => l.id)).toEqual(["r4", "r10"]);
    expect(r[0]).toBe("routes: 3 kept; skipped 1 express_bus not in profile");
  });

  it("drops segments with both stops outside the bbox when clipping", () => {
    const { file: west } = buildNetwork(demostadt(), { ...cfg, bbox: [0, 0.1, 0.05, 0.2] }, 2026);
    expect(west.segments.map((s) => [s.from, s.to])).toEqual([["r100", "n3"], ["r100", "n7"]]);
  });

  it("formats one element per line and parses back", () => {
    const text = formatNetwork(file);
    expect(JSON.parse(text)).toEqual(file);
    expect(text.split("\n")).toHaveLength(3 + 2 * 4 + file.groups.length + file.lines.length + file.stops.length + file.segments.length);
  });
});

it("normalises OSM colours", () => {
  expect(colour("#F00")).toBe("#ff0000");
  expect(colour("#7F77DD")).toBe("#7f77dd");
  expect(colour("7f77dd")).toBe("#7f77dd");
  expect(colour("Red")).toBe("red");
  expect(colour("rgb(1,2,3)")).toBeUndefined();
  expect(colour(undefined)).toBeUndefined();
});

it("queries the bbox in Overpass order: south, west, north, east", () => {
  expect(routesQuery([8.75, 48.55, 9.55, 49])).toContain("(48.55,8.75,49,9.55)");
});
