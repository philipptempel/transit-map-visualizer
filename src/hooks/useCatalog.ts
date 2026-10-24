import { useEffect, useState } from "react";
import type { MapEntry } from "@/schema";

/** The map catalog from data/maps.json; null while loading. */
export function useCatalog(): MapEntry[] | null {
  const [entries, setEntries] = useState<MapEntry[] | null>(null);
  useEffect(() => {
    // Plain fetch rather than the renderer's getJson, so the landing page doesn't pull in d3.
    fetch("data/maps.json")
      .then((res) => (res.ok ? (res.json() as Promise<MapEntry[]>) : []))
      .then(setEntries)
      .catch((err) => { console.error(err); setEntries([]); });
  }, []);
  return entries;
}
