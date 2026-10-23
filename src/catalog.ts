// Filtering and sorting of the map catalog shown on the landing page.

import type { CityEntry, MapType } from "./schema.ts";

export type SortKey = "name" | "created" | "updated";
export type SortDir = "asc" | "desc";

export interface Filters { type?: MapType; continent?: string; country?: string; state?: string }

export const MAP_TYPE_LABELS: Record<MapType, string> = {
  local: "Local", regional: "Regional", national: "National",
};

export const isAvailable = (c: CityEntry) => c.status !== "planned";

export const matches = (c: CityEntry, f: Filters) =>
  (["type", "continent", "country", "state"] as const).every((k) => !f[k] || c[k] === f[k]);

const byName = (a: CityEntry, b: CityEntry) => a.name.localeCompare(b.name);

/** Undated entries go last in both directions; ties fall back to the name. */
export function sortEntries(list: CityEntry[], key: SortKey, dir: SortDir): CityEntry[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    if (key === "name") return sign * byName(a, b);
    const x = a[key], y = b[key];
    if (!x || !y) return x ? -1 : y ? 1 : byName(a, b);
    return sign * x.localeCompare(y) || byName(a, b);
  });
}

/** Distinct values of one field, for the filter menus. */
export function distinct(list: CityEntry[], key: keyof Filters): string[] {
  return [...new Set(list.map((c) => c[key]).filter((v): v is string => !!v))];
}
