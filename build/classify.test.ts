import { describe, expect, it } from "vitest";
import { demostadt } from "./__fixtures__/load";
import { classify, included } from "./classify";
import type { MapConfig } from "./config";
import { routes } from "./sources/osm";

const cfg: MapConfig = {
  id: "demo", name: "Demo", scope: "city", network: "transit", country: "DE",
  bbox: [0, 0.02, 0.3, 0.28], clip: "bbox", profile: "local",
  sBahnLike: [{ ref: /^S\d+$/ }],
};

describe("classify", () => {
  it("classifies the fixture routes from their OSM tags", () => {
    const modes = Object.fromEntries(routes(demostadt()).map((r) => [r.id, classify(r.info, cfg)]));
    expect(modes).toEqual({ r1: "tram", r2: "tram", r3: "express_bus", r4: "s_bahn" });
  });

  it("checks overrides before anything else", () => {
    const zacke: MapConfig = { ...cfg, overrides: [{ match: { ref: /^10$/ }, mode: "rack_railway" }] };
    expect(classify({ ref: "10", osm: { route: "bus" } }, zacke)).toBe("rack_railway");
    expect(classify({ ref: "11", osm: { route: "bus" } }, zacke)).toBe("bus");
  });

  it("splits heavy rail by service and by the countries it reaches", () => {
    expect(classify({ osm: { route: "train" } }, cfg)).toBe("regional_rail");
    expect(classify({ osm: { route: "train", service: "high_speed" } }, cfg)).toBe("domestic_rail");
    expect(classify({ osm: { route: "train", rack: "yes" } }, cfg)).toBe("rack_railway");
    expect(classify({ osm: { route: "train" }, countries: ["DE", "FR"] }, cfg)).toBe("international_rail");
    // A map without a country (continent, world) has no "abroad".
    expect(classify({ osm: { route: "train" }, countries: ["DE", "FR"] }, { ...cfg, country: undefined })).toBe("regional_rail");
  });

  it("reads GTFS route types", () => {
    expect(classify({ gtfsType: 0 }, cfg)).toBe("tram");
    expect(classify({ gtfsType: 702 }, cfg)).toBe("express_bus");
    expect(classify({ gtfsType: 109, ref: "S3" }, cfg)).toBe("s_bahn");
    expect(classify({ gtfsType: 1700 }, cfg)).toBeNull();
  });

  it("applies the profile and per-map tweaks", () => {
    expect(included("tram", cfg)).toBe(true);
    expect(included("regional_rail", cfg)).toBe(false);
    expect(included("regional_rail", { ...cfg, include: { regional_rail: true } })).toBe(true);
    expect(included("flight", { ...cfg, profile: "air" })).toBe(true);
    expect(included("international_rail", { ...cfg, profile: "continental-rail" })).toBe(true);
  });
});

it("can require an OSM route type in an override", () => {
  const notBus: MapConfig = { ...cfg, overrides: [{ match: { ref: /^10$/, route: /^(?!(?:bus|trolleybus)$)/ }, mode: "rack_railway" }] };
  expect(classify({ ref: "10", osm: { route: "train", ref: "10" } }, notBus)).toBe("rack_railway");
  expect(classify({ ref: "10", osm: { route: "bus", ref: "10" } }, notBus)).toBe("bus");
  expect(classify({ ref: "10", osm: { route: "trolleybus", ref: "10" } }, notBus)).toBe("trolleybus");
});
