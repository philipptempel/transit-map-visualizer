import type { GroupDef, Mode } from "../src/schema";
export type { Mode } from "../src/schema";

export type Include = Record<Mode, boolean>;

const LOCAL: Include = {
  tram: true, tram_train: true, light_rail: true, metro: true, s_bahn: true,
  funicular: true, rack_railway: true, aerialway: true,
  bus: true, express_bus: true, trolleybus: true, ferry: true,
  suburban_rail: false, regional_rail: false, domestic_rail: false, international_rail: false,
};
const NONE = Object.fromEntries(Object.keys(LOCAL).map((k) => [k, false])) as Include;

export const PROFILES = {
  local: LOCAL,
  "local-plus-regional": { ...LOCAL, suburban_rail: true, regional_rail: true },
  "national-rail": { ...NONE, regional_rail: true, domestic_rail: true },
} satisfies Record<string, Include>;

export const DEFAULT_GROUPS: GroupDef[] = [
  { id: "tram",        label: "Tram",              modes: ["tram"],                color: "#c0392b", defaultOn: true,  schematic: true },
  { id: "tram_train",  label: "Tram-train",        modes: ["tram_train"],          color: "#8e44ad", defaultOn: true,  schematic: true },
  { id: "light_rail",  label: "Stadtbahn / metro", modes: ["light_rail", "metro"], color: "#2471a3", defaultOn: true,  schematic: true },
  { id: "s_bahn",      label: "S-Bahn",            modes: ["s_bahn"],              color: "#1e8449", defaultOn: true,  schematic: true },
  { id: "cable",       label: "Rack / funicular / cable", modes: ["rack_railway", "funicular", "aerialway"], color: "#7d6608", defaultOn: true, schematic: true },
  { id: "ferry",       label: "Ferry",             modes: ["ferry"],               color: "#148f9e", defaultOn: true,  schematic: true },
  { id: "express_bus", label: "Express bus / BRT", modes: ["express_bus"],         color: "#d35400", defaultOn: true,  schematic: true },
  { id: "bus",         label: "Bus",               modes: ["bus", "trolleybus"],   color: "#7f8c8d", defaultOn: false, schematic: false },
  { id: "rail",        label: "Rail",              modes: ["suburban_rail", "regional_rail", "domestic_rail", "international_rail"], color: "#34495e", defaultOn: true, schematic: true },
];

export interface Match { ref?: RegExp; name?: RegExp; network?: RegExp; operator?: RegExp }

export interface MapConfig {
  id: string; name: string;
  country: string;                              // ISO 3166-1 alpha-2, used for "international"
  bbox: [number, number, number, number];       // W, S, E, N
  clip: "bbox" | "whole-line";                  // cut at bbox, or keep any line touching it
  profile: keyof typeof PROFILES;
  include?: Partial<Include>;                   // per-map tweaks on top of the profile
  sBahnLike?: Match[];                          // heavy-rail routes that count as S-Bahn
  overrides?: { match: Match; mode: Mode }[];   // force a mode, checked first
  groups?: GroupDef[];
}

// Match rules are starting guesses; verify against what the feeds actually say.
export const MAPS: MapConfig[] = [
  {
    id: "nantes", name: "Nantes", country: "FR", bbox: [-1.80, 47.10, -1.35, 47.35],
    clip: "bbox", profile: "local",
    overrides: [{ match: { name: /busway/i }, mode: "express_bus" }],
  },
  {
    id: "stuttgart", name: "Stuttgart", country: "DE", bbox: [8.75, 48.55, 9.55, 49.00],
    clip: "whole-line", profile: "local",
    sBahnLike: [{ ref: /^S\d+$/ }],
    overrides: [
      { match: { ref: /^10$/ }, mode: "rack_railway" },   // Zacke
      { match: { ref: /^20$/ }, mode: "funicular" },      // Standseilbahn
      { match: { ref: /^U\d+$/ }, mode: "light_rail" },   // Stadtbahn, whatever the feed calls it
    ],
  },
  {
    id: "den-haag", name: "Den Haag", country: "NL", bbox: [4.18, 51.98, 4.45, 52.15],
    clip: "whole-line", profile: "local",                 // whole-line keeps RandstadRail E to Rotterdam
    overrides: [{ match: { network: /randstadrail/i }, mode: "light_rail" }],
  },
  {
    id: "rotterdam", name: "Rotterdam", country: "NL", bbox: [4.30, 51.83, 4.65, 52.00],
    clip: "bbox", profile: "local",
  },
  {
    id: "france-rail", name: "France (rail)", country: "FR", bbox: [-5.2, 41.3, 9.6, 51.1],
    clip: "bbox", profile: "national-rail",
  },
];
