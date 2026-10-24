import type { MapConfig } from "../config";

// Match rules are starting guesses; verify against what the data actually says.
export default {
  id: "den-haag", name: "Den Haag", scope: "city", network: "transit",
  continent: "Europe", country: "NL", state: "Zuid-Holland",
  bbox: [4.18, 51.98, 4.45, 52.15],
  clip: "whole-line", profile: "local",                 // whole-line keeps RandstadRail E to Rotterdam
  overrides: [{ match: { network: /randstadrail/i }, mode: "light_rail" }],
} satisfies MapConfig;
