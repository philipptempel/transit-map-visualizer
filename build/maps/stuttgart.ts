import type { MapConfig } from "../config";

export default {
  id: "stuttgart", name: "Stuttgart", scope: "city", network: "transit",
  continent: "Europe", country: "DE", state: "Baden-Württemberg",
  bbox: [8.75, 48.55, 9.55, 49.00],
  clip: "whole-line", profile: "local",
  sBahnLike: [{ ref: /^S\d+$/ }],
  // Checked against OSM data of 2026-10-24: the Standseilbahn (20) is tagged route=funicular and
  // the Stadtbahn (U1 to U19) route=light_rail, so they need no override. The Zacke is route=tram.
  // Matching on route=tram too keeps it off any bus line 10 elsewhere in the region.
  overrides: [
    { match: { ref: /^10$/, route: /^tram$/ }, mode: "rack_railway" },   // Zacke
  ],
  // No heritage services on any map. Trams 21 and 23 are SSB's heritage lines; excluded here in
  // case their OSM tags do not say so.
  exclude: [{ ref: /^2[13]$/, route: /^tram$/ }],
  lineColors: { bus: "#e2001a" },   // SSB red, for every bus line
} satisfies MapConfig;
