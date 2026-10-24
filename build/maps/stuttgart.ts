import type { MapConfig } from "../config";

const NOT_BUS = /^(?!(?:bus|trolleybus)$)/;

// Match rules are starting guesses; verify against what the data actually says.
export default {
  id: "stuttgart", name: "Stuttgart", scope: "city", network: "transit",
  continent: "Europe", country: "DE", state: "Baden-Württemberg",
  bbox: [8.75, 48.55, 9.55, 49.00],
  clip: "whole-line", profile: "local",
  sBahnLike: [{ ref: /^S\d+$/ }],
  // A region with several bus networks can have more than one line 10, so none of these may catch a bus.
  overrides: [
    { match: { ref: /^10$/, route: NOT_BUS }, mode: "rack_railway" },   // Zacke
    { match: { ref: /^20$/, route: NOT_BUS }, mode: "funicular" },      // Standseilbahn
    { match: { ref: /^U\d+$/, route: NOT_BUS }, mode: "light_rail" },   // Stadtbahn, whatever OSM calls it
  ],
} satisfies MapConfig;
