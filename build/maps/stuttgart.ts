import type { MapConfig } from "../config";

// Match rules are starting guesses; verify against what the data actually says.
export default {
  id: "stuttgart", name: "Stuttgart", scope: "city", network: "transit",
  continent: "Europe", country: "DE", state: "Baden-Württemberg",
  bbox: [8.75, 48.55, 9.55, 49.00],
  clip: "whole-line", profile: "local",
  sBahnLike: [{ ref: /^S\d+$/ }],
  overrides: [
    { match: { ref: /^10$/ }, mode: "rack_railway" },   // Zacke
    { match: { ref: /^20$/ }, mode: "funicular" },      // Standseilbahn
    { match: { ref: /^U\d+$/ }, mode: "light_rail" },   // Stadtbahn, whatever the feed calls it
  ],
} satisfies MapConfig;
