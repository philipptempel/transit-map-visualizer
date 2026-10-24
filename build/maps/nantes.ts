import type { MapConfig } from "../config";

// Match rules are starting guesses; verify against what the data actually says.
export default {
  id: "nantes", name: "Nantes", scope: "city", network: "transit",
  continent: "Europe", country: "FR", state: "Pays de la Loire",
  bbox: [-1.80, 47.10, -1.35, 47.35],
  clip: "bbox", profile: "local",
  overrides: [{ match: { name: /busway/i }, mode: "express_bus" }],
} satisfies MapConfig;
