import { describe, expect, it } from "vitest";
import { demostadt } from "../__fixtures__/load";
import { checkNetwork } from "../check";
import type { MapConfig } from "../config";
import { buildNetwork, colour, formatDetail, formatNetwork, routesQuery } from "./network";

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
    // On its track (the stop position), not at the station node beside it.
    expect(file.stops.find((s) => s.id === "r100")).toEqual({ id: "r100", name: "Westpark", geo: [0.028, 0.128] });
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

describe("buildNetwork on whole-line maps", () => {
  it("drops routes that run beyond the margin around the bbox, and names them", () => {
    // The margin reaches to x = 0.2: the S1 to the northern Markt stays, routes on to Dom (x = 0.212) go.
    const { file, report } = buildNetwork(demostadt(), { ...cfg, clip: "whole-line", bbox: [0, 0.1, 0.1, 0.15] }, 2026);
    expect(file.lines.map((l) => l.id)).toEqual(["r4"]);
    expect(report[0]).toBe("routes: 1 kept; skipped 3 running off the map");
    expect(report.slice(1, 5)).toEqual([
      "off the map (beyond -0.10, 0.05, 0.20, 0.20), e.g.:",
      '  r1 "Tram 1: Westpark => Dom" (route=tram, network=Demo)',
      '  r2 "Tram 1: Dom => Westpark" (route=tram, network=Demo)',
      '  r3 "Bus X3: Markt => Dom" (route=bus, network=Demo)',
    ]);
  });
});

describe("buildNetwork reports", () => {
  it("names what each override caught", () => {
    const { report } = buildNetwork(demostadt(), { ...cfg, overrides: [{ match: { ref: /^X3$/ }, mode: "bus" }, { match: { ref: /^9$/ }, mode: "tram" }] }, 2026);
    expect(report).toContain("override ref=/^X3$/ → bus: 1 route");
    expect(report).toContain('  r3 "Bus X3: Markt => Dom" (route=bus, network=Demo)');
    expect(report).toContain("override ref=/^9$/ → tram: 0 routes");
  });

  it("skips long-distance coaches", () => {
    const osm = demostadt();
    osm.relations.get(3)!.tags!.service = "long_distance";
    const { report } = buildNetwork(osm, cfg, 2026);
    expect(report[0]).toBe("routes: 3 kept; skipped 1 long-distance coach");
  });

  it("simplifies bus geometry harder, then drops it, to fit the budget; rail keeps its track", () => {
    const { file, report } = buildNetwork(demostadt(), cfg, 2026, 1000);   // too small even with straight buses
    expect(report.filter((r) => r.startsWith("over the"))).toEqual([
      "over the 0.0 MB budget: bus/trolleybus/express_bus geometry simplified to 30 m",
      "over the 0.0 MB budget: bus/trolleybus/express_bus geometry simplified to 60 m",
      "over the 0.0 MB budget: bus/trolleybus/express_bus geometry simplified to 120 m",
      "over the 0.0 MB budget: bus/trolleybus/express_bus geometry left straight",
    ]);
    expect(file.segments.find((s) => s.mode === "express_bus")!.geo).toBeUndefined();
    expect(file.segments.find((s) => s.mode === "tram")!.geo).toHaveLength(3);
  });

  it("leaves out heritage services, and what the map config excludes", () => {
    const osm = demostadt();
    osm.relations.get(4)!.tags!.heritage = "2";
    const { file, report } = buildNetwork(osm, { ...cfg, exclude: [{ ref: /^X3$/ }] }, 2026);
    expect(file.lines.map((l) => l.id)).toEqual(["r10"]);
    expect(report[0]).toBe("routes: 2 kept; skipped 1 excluded by the map config, 1 heritage or tourist");
  });

  it("colours every line of a mode when the config says so", () => {
    const { file } = buildNetwork(demostadt(), { ...cfg, lineColors: { express_bus: "#e2001a", s_bahn: "#123456" } }, 2026);
    expect(file.lines.map((l) => [l.id, l.color])).toEqual([["r3", "#e2001a"], ["r4", "#123456"], ["r10", "#7f77dd"]]);
  });

  it("leaves a file under budget alone", () => {
    expect(buildNetwork(demostadt(), cfg, 2026).report.some((r) => r.startsWith("over the"))).toBe(false);
  });
});

describe("stops and detail", () => {
  const { file, detail, report } = buildNetwork(demostadt(), cfg, 2026);

  it("ends every segment exactly at its stops' points", () => {
    const at = new Map(file.stops.map((s) => [s.id, s.geo] as const));
    for (const s of file.segments) {
      if (!s.geo) continue;
      expect(s.geo[0]).toEqual(at.get(s.from));
      expect(s.geo.at(-1)).toEqual(at.get(s.to));
    }
    expect(report.find((r) => r.startsWith("stops placed"))).toMatch(/^stops placed on their track: 4,/);   // n7 has no track in the fixture
  });

  it("puts a stop on the track of its most prominent group, not the bus stop beside it", () => {
    // Markt is the tram stop position n5 and the bus platform n6, 80 m apart; the tram wins.
    expect(file.stops.find((s) => s.id === "n5")!.geo).toEqual([0.168, 0.15]);
  });

  it("keeps one detail entry per segment, null where network.json is already exact", () => {
    expect(detail).toHaveLength(file.segments.length);
    // The fixture's tracks are already as simple as they get.
    expect(detail.every((d) => d === null)).toBe(true);
    expect(JSON.parse(formatDetail(detail))).toEqual({ segments: detail });
  });

  it("carries the finer geometry when network.json's is coarser", () => {
    const { file: f, detail: d } = buildNetwork(demostadt(), cfg, 2026, 1000);   // forces straight buses
    const bus = f.segments.findIndex((s) => s.mode === "express_bus");
    expect(f.segments[bus].geo).toBeUndefined();
    expect(d[bus]).toHaveLength(3);
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
