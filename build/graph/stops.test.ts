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

describe("dedupeStops with the lines that stop there", () => {
  const at = (id: string, x: number, y = 0) => ({ id, name: "Stop", geo: [x, y] as [number, number] });
  const served = (lines: string[], group: string) => ({ lines: new Set(lines), groups: new Set([group]) });

  it("merges one line's two platforms even where its track curves between them", () => {
    // Bubenbad: U15 each way, 100 m apart, tracks 60° apart on the curve.
    const d = dedupeStops([at("n1", 0), at("n2", 0.0009)], 300,
      new Map([["n1", [0]], ["n2", [60]]]), new Map([["n1", served(["U15"], "rail")], ["n2", served(["U15"], "rail")]]));
    expect(d.stops).toHaveLength(1);
  });

  it("keeps crossing platforms of one group apart, even when a bus line stops at both", () => {
    // Charlottenplatz: U5 runs north–south, U2 east–west, 80 m apart; bus 44 stops beside both.
    const d = dedupeStops([at("n1", 0), at("n2", 0.00072), at("n3", 0, 0.0001), at("n4", 0.00072, 0.0001)], 300,
      new Map([["n1", [90]], ["n2", [0]], ["n3", [90]], ["n4", [0]]]),
      new Map([["n1", served(["U5"], "rail")], ["n2", served(["U2"], "rail")], ["n3", served(["44"], "bus")], ["n4", served(["44"], "bus")]]));
    expect(d.stops.map((s) => s.members.sort())).toEqual([["n1", "n3"], ["n2", "n4"]]);
  });

  it("lets a bus stop round the corner join the station when a line links them", () => {
    const d = dedupeStops([at("n1", 0), at("n2", 0.0009), at("n3", 0.0005)], 300,
      new Map([["n1", [0]], ["n2", [90]], ["n3", [0]]]),
      new Map([["n1", served(["S1"], "rail")], ["n2", served(["42"], "bus")], ["n3", { lines: new Set(["S1", "42"]), groups: new Set(["rail", "bus"]) }]]));
    expect(d.stops).toHaveLength(1);
  });
});
