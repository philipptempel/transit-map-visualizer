import { describe, expect, it } from "vitest";
import { demostadt } from "../__fixtures__/load";
import { routes, stopCandidates } from "../sources/osm";
import { dedupeStops } from "./stops";

describe("dedupeStops", () => {
  const osm = demostadt();
  const { stops, stopOf } = dedupeStops(stopCandidates(osm, routes(osm)));

  it("merges a stop area into one stop, placed at its station", () => {
    const wp = stops.find((s) => s.id === "r100")!;
    expect(wp).toMatchObject({ name: "Westpark", geo: [0.0283, 0.1284], members: ["n1", "n2", "n9"], wikidata: "Q0000001" });
  });

  it("merges same-named stops within 300 m, and only those", () => {
    expect(stopOf.get("n4")).toBe("n3");
    expect(stopOf.get("n6")).toBe("n5");     // 80 m from the tram stop
    expect(stopOf.get("n7")).toBe("n7");     // also "Markt", but 2 km away
    expect(stops.map((s) => [s.id, s.name])).toEqual([
      ["n3", "Hafen"], ["n5", "Markt"], ["n7", "Markt"], ["n8", "Dom"], ["r100", "Westpark"],
    ]);
  });

  it("places a cluster without a station at the mean of its members", () => {
    const [lon, lat] = stops.find((s) => s.id === "n3")!.geo;
    expect(lon).toBeCloseTo(0.0951, 9);
    expect(lat).toBeCloseTo(0.1421, 9);
  });

  it("keeps unnamed stops apart", () => {
    const d = dedupeStops([{ id: "n1", geo: [0, 0] }, { id: "n2", geo: [0, 0.0001] }]);
    expect(d.stops).toHaveLength(2);
  });
});

describe("dedupeStops with track directions", () => {
  // 0.001° is about 111 m. Two platforms called "Berliner Platz", 120 m apart.
  const ns = { id: "n1", name: "Berliner Platz", geo: [0, 0] as [number, number] };
  const ew = { id: "n2", name: "Berliner Platz", geo: [0.00108, 0] as [number, number] };

  it("keeps platforms apart whose tracks cross", () => {
    const d = dedupeStops([ns, ew], 300, new Map([["n1", [90]], ["n2", [0, 180]]]));
    expect(d.stops.map((s) => [s.id, s.name])).toEqual([["n1", "Berliner Platz"], ["n2", "Berliner Platz"]]);
  });

  it("merges them when their tracks run the same way, or they are within 30 m", () => {
    expect(dedupeStops([ns, ew], 300, new Map([["n1", [85]], ["n2", [100]]])).stops).toHaveLength(1);
    const close = { ...ew, geo: [0.0002, 0] as [number, number] };   // 22 m
    expect(dedupeStops([ns, close], 300, new Map([["n1", [90]], ["n2", [0]]])).stops).toHaveLength(1);
  });

  it("does not let a platform without a direction bridge the two", () => {
    const mid = { id: "n3", name: "Berliner Platz", geo: [0.00054, 0] as [number, number] };
    const d = dedupeStops([ns, ew, mid], 300, new Map([["n1", [90]], ["n2", [0]]]));
    expect(d.stops).toHaveLength(2);
  });

  it("gives a split stop area's id to one part only", () => {
    const area = { id: "r9", name: "Berliner Platz" };
    const d = dedupeStops([{ ...ns, area }, { ...ew, area }], 300, new Map([["n1", [90]], ["n2", [0]]]));
    expect(d.stops.map((s) => s.id)).toEqual(["n2", "r9"]);
  });
});
