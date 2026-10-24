import { geoArea } from "d3-geo";
import { describe, expect, it } from "vitest";
import { OsmIndex, type OsmElement } from "../sources/osm";
import { basemapFeatures, coverage, detailFor, kindOf, shapeBasemap } from "./basemap";

// A lake drawn as a multipolygon of two half-rings (counter-clockwise, as OSM often has them)
// with an island, a park as a closed way, and a road running out of the bbox.
const g = (pts: [number, number][]) => pts.map(([lon, lat]) => ({ lat, lon }));
const elements: OsmElement[] = [
  { type: "relation", id: 1, tags: { type: "multipolygon", natural: "water" }, members: [
    { type: "way", ref: 10, role: "outer" }, { type: "way", ref: 11, role: "outer" }, { type: "way", ref: 12, role: "inner" },
  ] },
  { type: "way", id: 10, geometry: g([[0, 0], [0.01, 0], [0.01, 0.01]]) },
  { type: "way", id: 11, geometry: g([[0, 0], [0, 0.01], [0.01, 0.01]]) },
  { type: "way", id: 12, geometry: g([[0.004, 0.004], [0.006, 0.004], [0.006, 0.006], [0.004, 0.006], [0.004, 0.004]]) },
  { type: "way", id: 20, tags: { leisure: "park" }, geometry: g([[0.02, 0.02], [0.02, 0.025], [0.025, 0.025], [0.025, 0.02], [0.02, 0.02]]) },
  { type: "way", id: 30, tags: { highway: "primary" }, geometry: g([[0.005, 0.015], [0.05, 0.015]]) },
  { type: "way", id: 40, tags: { highway: "residential" }, geometry: g([[0, 0.02], [0.01, 0.02]]) },
];

describe("basemap", () => {
  const features = basemapFeatures(new OsmIndex(elements));

  it("turns multipolygons, closed ways and lines into kinds", () => {
    expect(features.map((f) => [f.properties?.kind, f.geometry.type])).toEqual([
      ["water", "MultiPolygon"], ["green", "Polygon"], ["road", "LineString"],
    ]);
    const lake = features[0].geometry as { coordinates: number[][][][] };
    expect(lake.coordinates[0]).toHaveLength(2);   // outer ring with the island as a hole
    expect(kindOf({ highway: "residential" })).toBeNull();
  });

  it("clips, drops small areas, and winds rings the way d3-geo expects", async () => {
    const fc = await shapeBasemap(features, { bbox: [-0.001, -0.001, 0.03, 0.03], interval: 5, minArea: 20000 });
    expect(fc.features.map((f) => f.properties?.kind)).toEqual(["water", "green", "road"]);
    const road = fc.features[2].geometry as { coordinates: number[][] };
    expect(Math.max(...road.coordinates.map((p) => p[0]))).toBeCloseTo(0.03, 5);
    // A ring wound the wrong way reads as the whole globe minus the lake: about 4π steradians.
    for (const f of fc.features.slice(0, 2)) expect(geoArea(f)).toBeLessThan(1e-6);
    const small = await shapeBasemap(features, { bbox: [-0.001, -0.001, 0.03, 0.03], interval: 5, minArea: 1e7 });
    expect(small.features.map((f) => f.properties?.kind)).toEqual(["road"]);
  });
});

describe("coverage", () => {
  const bbox = [9, 48.5, 9.5, 49] as [number, number, number, number];

  it("reaches as far as the network does, with a margin, rounded outwards to 0.01°", () => {
    const net = {
      groups: [], lines: [],
      stops: [{ id: "a", name: "A", geo: [8.6, 48.7] as [number, number] }],
      segments: [{ from: "a", to: "b", mode: "s_bahn" as const, geo: [[8.6, 48.7], [9.2, 49.2]] as [number, number][] }],
    };
    expect(coverage(net, bbox)).toEqual([8.57, 48.48, 9.53, 49.22]);
  });

  it("covers at least the bbox, and only that without a network", () => {
    expect(coverage(null, bbox, 0)).toEqual(bbox);
  });
});

describe("detailFor", () => {
  it("simplifies a larger area more, so the file stays about the same size", () => {
    expect(detailFor([0, 0, 1, 1], [0, 0, 1, 1])).toEqual({ interval: 15, minArea: 20000 });
    expect(detailFor([0, 0, 2, 2], [0, 0, 1, 1])).toEqual({ interval: 30, minArea: 80000 });
  });
});
