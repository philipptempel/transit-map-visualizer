// Shared between the fetch step (build/) and the renderer (src/).

export type Mode =
  | "tram" | "tram_train" | "light_rail" | "metro" | "s_bahn"
  | "funicular" | "rack_railway" | "aerialway"
  | "bus" | "express_bus" | "trolleybus" | "ferry"
  | "suburban_rail" | "regional_rail" | "domestic_rail" | "international_rail"
  | "flight" | "cruise" | "ocean_liner";

/** "YYYY", "YYYY-MM", "YYYY-MM-DD" or a decimal year. null/undefined = open-ended. */
export type DateLike = string | number | null | undefined;
export type LonLat = [lon: number, lat: number];
export type BBox = [west: number, south: number, east: number, north: number];

export interface ToggleGroup { id: string; label: string; defaultOn: boolean }

export interface GroupDef extends ToggleGroup {
  modes: Mode[];
  color: string;
  schematic: boolean;              // false = fades out in schematic mode
  coverage?: { from?: string };    // earliest year with real data, set by the fetch step
}

export type MapType = "local" | "regional" | "national" | "continental" | "global";
export type Network = "transit" | "rail" | "air" | "sea";
export type Projection = "mercator" | "equalEarth";

/** One entry in data/maps.json, the catalog shown on the landing page. */
export interface MapEntry {
  id: string; name: string; bbox: BBox;
  type: MapType;
  network: Network;
  continent?: string;              // e.g. "Europe"; absent for fictional maps
  country?: string;                // ISO 3166-1 alpha-2
  state?: string;                  // first-level administrative region
  created?: string;                // "YYYY-MM-DD" the map was added
  updated?: string;                // "YYYY-MM-DD" its data last changed
  status?: "available" | "planned";   // planned = configured, no data yet
  fictional?: boolean;
  attribution?: string[];          // data credits shown on the map page, e.g. "© OpenStreetMap contributors"
  projection?: Projection;         // default mercator
}

export interface Line { id: string; ref?: string; name?: string; mode: Mode; color?: string }

export interface Stop {
  id: string; name: string;
  geo: LonLat; schem?: LonLat;
  start?: DateLike; end?: DateLike;
  src?: string;                    // where the dates came from
}

export interface LineOnSegment { id: string; start?: DateLike; end?: DateLike; src?: string }

/** A segment grows from `from` towards `to`: put the stop that came first in `from`. */
export interface Segment {
  from: string; to: string; mode: Mode;
  lines?: (string | LineOnSegment)[];
  geo?: LonLat[]; schem?: LonLat[];
  start?: DateLike; end?: DateLike;
  src?: string;
}

export interface NetworkFile { groups: GroupDef[]; lines: Line[]; stops: Stop[]; segments: Segment[] }

export interface BasemapSnap { url: string; source: string; year?: number }
export interface BasemapIndex { current: BasemapSnap | null; snapshots: (BasemapSnap & { year: number })[] }

export interface Landmark { name: string; geo: LonLat; start?: DateLike; end?: DateLike; anchor?: string }
