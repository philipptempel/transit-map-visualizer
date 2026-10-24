// Resolves `--area` for `fetch new`: a bbox, a continent code, an ISO 3166 code or a place name.

import type { BBox } from "../src/schema";
import type { CacheOptions } from "./sources/cache";
import { searchPlace } from "./sources/nominatim";
import { overpass } from "./sources/overpass";

export interface Area { bbox: BBox; name?: string; continent?: string; country?: string; state?: string }

/**
 * Continent codes as OurAirports uses them. EU is Europe the continent, not the European Union.
 * The boxes are rough (Asia and Oceania stop at the antimeridian); edit them in the written config.
 */
export const CONTINENTS: Record<string, { name: string; bbox: BBox }> = {
  AF: { name: "Africa",        bbox: [-26, -35, 52, 38] },
  AN: { name: "Antarctica",    bbox: [-180, -90, 180, -60] },
  AS: { name: "Asia",          bbox: [25, -11, 180, 82] },
  EU: { name: "Europe",        bbox: [-25, 34, 60, 72] },
  NA: { name: "North America", bbox: [-170, 5, -50, 84] },
  OC: { name: "Oceania",       bbox: [110, -53, 180, 1] },
  SA: { name: "South America", bbox: [-82, -56, -34, 13] },
};

export function parseBBox(s: string): BBox | null {
  const parts = s.split(",").map((x) => x.trim());
  if (parts.length !== 4 || parts.some((x) => x === "" || !Number.isFinite(Number(x)))) return null;
  const [w, so, e, n] = parts.map(Number);
  const ok = w >= -180 && e <= 180 && so >= -90 && n <= 90 && w < e && so < n;
  return ok ? [w, so, e, n] : null;
}

export const ISO_3166 = /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/;

/** An ISO 3166-1 or -2 code's bbox, from the admin boundary carrying that code in OSM. */
async function isoArea(code: string, opts: CacheOptions): Promise<Area> {
  const key = code.includes("-") ? "ISO3166-2" : "ISO3166-1";
  const res = await overpass(`[out:json][timeout:60];relation["boundary"="administrative"]["${key}"="${code}"];out tags bb;`, opts);
  const rel = res.elements[0] as { bounds?: { minlon: number; minlat: number; maxlon: number; maxlat: number }; tags?: Record<string, string> } | undefined;
  if (!rel?.bounds) throw new Error(`No admin boundary in OSM with ${key}=${code}`);
  const b = rel.bounds;
  return {
    bbox: [b.minlon, b.minlat, b.maxlon, b.maxlat],
    name: rel.tags?.["name:en"] ?? rel.tags?.name,
    country: code.slice(0, 2),
    state: code.includes("-") ? rel.tags?.["name:en"] ?? rel.tags?.name : undefined,
  };
}

export async function resolveArea(area: string, continentScope: boolean, opts: CacheOptions = {}): Promise<Area> {
  const bbox = parseBBox(area);
  if (bbox) return { bbox };
  if (continentScope) {
    const c = CONTINENTS[area.toUpperCase()];
    if (!c) throw new Error(`Unknown continent code "${area}"; use one of ${Object.keys(CONTINENTS).join(" ")}`);
    return { bbox: c.bbox, name: c.name, continent: c.name };
  }
  if (ISO_3166.test(area)) return isoArea(area, opts);
  const place = await searchPlace(area, opts);
  if (!place) throw new Error(`Nominatim found nothing for "${area}"`);
  return place;
}
