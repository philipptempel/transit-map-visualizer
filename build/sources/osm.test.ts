import { describe, expect, it } from "vitest";
import { demostadt } from "../__fixtures__/load";
import { compareIds, routes, stopCandidates } from "./osm";

describe("routes", () => {
  it("reads stops in member order, preferring stop roles over platforms", () => {
    const rs = routes(demostadt());
    expect(rs.map((r) => [r.id, r.master, r.stops])).toEqual([
      ["r1", "r10", ["n1", "n3", "n5", "n8"]],
      ["r2", "r10", ["n8", "n5", "n3", "n1"]],
      ["r3", undefined, ["n6", "n8"]],          // platforms only
      ["r4", undefined, ["n9", "n7"]],
    ]);
    expect(rs[0].path).toHaveLength(3);
    expect(rs[0].info).toMatchObject({ ref: "1", name: "Tram 1: Westpark => Dom", network: "Demo" });
  });
});

describe("stopCandidates", () => {
  it("collects the stops routes use, with their stop area and its station", () => {
    const osm = demostadt();
    const c = stopCandidates(osm, routes(osm));
    expect(c.map((s) => s.id)).toEqual(["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9"]);
    expect(c.find((s) => s.id === "n9")).toMatchObject({ station: true, area: { id: "r100", name: "Westpark" }, wikidata: "Q0000001" });
    expect(c.find((s) => s.id === "n3")?.area).toBeUndefined();
  });
});

it("orders OSM ids by type, then numerically", () => {
  expect(["w1", "n10", "r2", "n2"].sort(compareIds)).toEqual(["n2", "n10", "r2", "w1"]);
});
