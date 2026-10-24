import type { BBox, GroupDef, MapType, Mode, Network, Projection } from "../src/schema";
export type { Mode, Network } from "../src/schema";

export type Include = Record<Mode, boolean>;

const NONE: Include = {
  tram: false, tram_train: false, light_rail: false, metro: false, s_bahn: false,
  funicular: false, rack_railway: false, aerialway: false,
  bus: false, express_bus: false, trolleybus: false, ferry: false,
  suburban_rail: false, regional_rail: false, domestic_rail: false, international_rail: false,
  flight: false, cruise: false, ocean_liner: false,
};
const LOCAL: Include = {
  ...NONE,
  tram: true, tram_train: true, light_rail: true, metro: true, s_bahn: true,
  funicular: true, rack_railway: true, aerialway: true,
  bus: true, express_bus: true, trolleybus: true, ferry: true,
};

export const PROFILES = {
  local: LOCAL,
  "local-plus-regional": { ...LOCAL, suburban_rail: true, regional_rail: true },
  "national-rail": { ...NONE, regional_rail: true, domestic_rail: true },
  "continental-rail": { ...NONE, domestic_rail: true, international_rail: true },
  air: { ...NONE, flight: true },
  sea: { ...NONE, ferry: true, cruise: true, ocean_liner: true },
} satisfies Record<string, Include>;

export type Profile = keyof typeof PROFILES;

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

export type Scope = "city" | "region" | "country" | "continent" | "world";

export const SCOPE_TYPE: Record<Scope, MapType> = {
  city: "local", region: "regional", country: "national", continent: "continental", world: "global",
};

export interface Match { ref?: RegExp; name?: RegExp; network?: RegExp; operator?: RegExp }

/** An airline or shipping company drawn as one line; `from`/`to` bound the years it operated. */
export interface Operator { name: string; color: string; from?: string; to?: string }

/** One map, in build/maps/<id>.ts. Everything the fetch step needs to rebuild it. */
export interface MapConfig {
  id: string; name: string;
  scope: Scope;
  network: Network;
  continent?: string;                           // catalog fields, e.g. "Europe", "DE", "Baden-Württemberg"
  country?: string;                             // ISO 3166-1 alpha-2; also decides what counts as "international"
  state?: string;
  bbox: BBox;                                   // W, S, E, N
  clip: "bbox" | "whole-line";                  // cut at bbox, or keep any line touching it
  profile: Profile;
  include?: Partial<Include>;                   // per-map tweaks on top of the profile
  sBahnLike?: Match[];                          // heavy-rail routes that count as S-Bahn
  overrides?: { match: Match; mode: Mode }[];   // force a mode, checked first
  groups?: GroupDef[];
  operators?: Operator[];                       // air and sea: the operator and its predecessors
  projection?: Projection;
}
