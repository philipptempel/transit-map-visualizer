import type { MapConfig } from "../config";

export default {
  id: "france-rail", name: "France (rail)", scope: "country", network: "rail",
  continent: "Europe", country: "FR",
  bbox: [-5.2, 41.3, 9.6, 51.1],
  clip: "bbox", profile: "national-rail",
} satisfies MapConfig;
