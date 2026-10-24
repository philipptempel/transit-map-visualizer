import type { MapConfig } from "../config";

export default {
  id: "rotterdam", name: "Rotterdam", scope: "city", network: "transit",
  continent: "Europe", country: "NL", state: "Zuid-Holland",
  bbox: [4.30, 51.83, 4.65, 52.00],
  clip: "bbox", profile: "local",
} satisfies MapConfig;
