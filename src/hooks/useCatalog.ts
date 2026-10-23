import { useEffect, useState } from "react";
import type { CityEntry } from "@/schema";

/** The map catalog from data/cities.json; null while loading. */
export function useCatalog(): CityEntry[] | null {
  const [entries, setEntries] = useState<CityEntry[] | null>(null);
  useEffect(() => {
    // Plain fetch rather than the renderer's getJson, so the landing page doesn't pull in d3.
    fetch("data/cities.json")
      .then((res) => (res.ok ? (res.json() as Promise<CityEntry[]>) : []))
      .then(setEntries)
      .catch((err) => { console.error(err); setEntries([]); });
  }, []);
  return entries;
}
