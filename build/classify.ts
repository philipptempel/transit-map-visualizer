import { PROFILES, type MapConfig, type Match, type Mode } from "./config";

export interface RouteInfo {
  ref?: string; name?: string; network?: string; operator?: string;
  osm?: Record<string, string>;   // tags of an OSM route relation
  gtfsType?: number;              // GTFS route_type, basic or extended
  countries?: string[];           // countries the route's stops lie in
}

export const test = (m: Match, r: RouteInfo) =>
  (["ref", "name", "network", "operator"] as const).every((k) => !m[k] || m[k]!.test(r[k] ?? "")) &&
  (!m.route || m.route.test(r.osm?.route ?? ""));

/** Long-distance coaches are tagged route=bus too; no map profile wants them as local buses. */
export const isCoach = (t: Record<string, string>) =>
  t.route === "bus" && (t.service === "long_distance" || t.service === "coach" || t.bus === "coach");

/** Heritage and tourist services: museum trams, steam trains, sightseeing boats. No map keeps them. */
export const isHeritage = (t: Record<string, string>) =>
  (!!t.heritage && t.heritage !== "no") || ["tourism", "tourist", "heritage"].includes(t.service ?? "") || t.usage === "tourism";

function fromOsm(t: Record<string, string>): Mode | null {
  if (isCoach(t)) return null;
  switch (t.route) {
    case "tram": return "tram";
    case "light_rail": return "light_rail";
    case "subway": case "monorail": return "metro";
    case "funicular": return "funicular";
    case "aerialway": return "aerialway";
    case "trolleybus": return "trolleybus";
    case "ferry": return "ferry";
    case "bus":   // express tagging is inconsistent; overrides do the real work
      return t.service === "express" || /^X\d/.test(t.ref ?? "") ? "express_bus" : "bus";
    case "train":
      if (t.rack === "yes") return "rack_railway";
      if (t.service === "commuter" || t.service === "urban") return "suburban_rail";
      if (["long_distance", "high_speed", "night"].includes(t.service)) return "domestic_rail";
      return "regional_rail";
  }
  return null;
}

function fromGtfs(t: number): Mode | null {
  if (t === 0 || t === 5 || (t >= 900 && t < 1000)) return "tram";
  if (t === 1 || t === 12 || (t >= 400 && t < 500)) return "metro";
  if (t === 702) return "express_bus";
  if (t === 3 || (t >= 700 && t < 800)) return "bus";
  if (t === 11 || t === 800) return "trolleybus";
  if (t === 4 || t === 1000 || t === 1200) return "ferry";
  if (t === 6 || t === 1300) return "aerialway";
  if (t === 7 || t === 1400) return "funicular";
  if (t === 109) return "suburban_rail";
  if ([101, 102, 103, 105].includes(t)) return "domestic_rail";
  if (t === 2 || (t >= 100 && t < 200)) return "regional_rail";
  return null;
}

const HEAVY: Mode[] = ["suburban_rail", "regional_rail", "domestic_rail"];

export function classify(r: RouteInfo, map: MapConfig): Mode | null {
  const forced = map.overrides?.find((o) => test(o.match, r));
  if (forced) return forced.mode;
  const mode = r.osm ? fromOsm(r.osm) : r.gtfsType != null ? fromGtfs(r.gtfsType) : null;
  if (!mode || !HEAVY.includes(mode)) return mode;
  if (map.sBahnLike?.some((m) => test(m, r))) return "s_bahn";
  if (map.country && r.countries?.some((c) => c !== map.country)) return "international_rail";
  return mode;
}

export const included = (mode: Mode, map: MapConfig) =>
  ({ ...PROFILES[map.profile], ...map.include })[mode] ?? false;
