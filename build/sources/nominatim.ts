// Place-name lookup for `fetch new --area "Karlsruhe, DE"`. Used once per new map, then the
// bbox lives in the config. Nominatim's policy asks for a User-Agent and at most 1 request/s.

import type { BBox } from "../../src/schema";
import { cached, request, type CacheOptions } from "./cache";

export interface Place { name: string; bbox: BBox; country?: string; state?: string }

interface Hit {
  display_name: string; boundingbox: [string, string, string, string];   // S, N, W, E
  address?: { country_code?: string; state?: string };
}

export function parsePlace(hits: Hit[]): Place | null {
  const h = hits[0];
  if (!h) return null;
  const [s, n, w, e] = h.boundingbox.map(Number);
  return {
    name: h.display_name.split(",")[0].trim(),
    bbox: [w, s, e, n],
    country: h.address?.country_code?.toUpperCase(),
    state: h.address?.state,
  };
}

export async function searchPlace(q: string, opts: CacheOptions = {}): Promise<Place | null> {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: "jsonv2", limit: "1", addressdetails: "1" })}`;
  const hits = await cached("nominatim", url, async () => (await request(url)).json() as Promise<Hit[]>, opts);
  return parsePlace(hits);
}
