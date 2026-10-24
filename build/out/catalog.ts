// Keeps public/data/maps.json in step with the map configs. Entries without a config
// (Demostadt) are left alone; entries with one take their name, bbox and location from it.

import { readFile, writeFile } from "node:fs/promises";
import type { MapEntry } from "../../src/schema";
import { SCOPE_TYPE, type MapConfig } from "../config";

export interface CatalogUpdate {
  available: boolean;       // network.json exists and passed the checks
  changed: boolean;         // this run wrote data that differs from what was there
  attribution?: string[];   // credits for the sources this run used
  today: string;            // YYYY-MM-DD
}

export function entryFor(cfg: MapConfig, prev: MapEntry | undefined, u: CatalogUpdate): MapEntry {
  const e: MapEntry = {
    ...prev,
    id: cfg.id, name: cfg.name, bbox: cfg.bbox,
    type: SCOPE_TYPE[cfg.scope], network: cfg.network,
    continent: cfg.continent, country: cfg.country, state: cfg.state,
    created: prev?.created ?? (u.available ? u.today : undefined),   // planned maps have not been added yet
    updated: u.changed ? u.today : prev?.updated,
    status: u.available ? "available" : "planned",
    attribution: u.attribution ?? prev?.attribution,
    projection: cfg.projection,
  };
  for (const k of Object.keys(e) as (keyof MapEntry)[]) if (e[k] === undefined) delete e[k];
  return e;
}

// One line per group of fields, in this order, so the file stays readable and diffs stay small.
const LINES: (keyof MapEntry)[][] = [
  ["id", "name", "bbox"],
  ["type", "network", "continent", "country", "state"],
  ["created", "updated", "status", "fictional"],
  ["attribution", "projection"],
];

const value = (v: unknown) => (Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : JSON.stringify(v));

export function formatCatalog(entries: MapEntry[]): string {
  const known = new Set(LINES.flat());
  const body = entries.map((e) => {
    const rest = (Object.keys(e) as (keyof MapEntry)[]).filter((k) => !known.has(k));
    const lines = [...LINES, rest]
      .map((keys) => keys.filter((k) => e[k] !== undefined).map((k) => `${JSON.stringify(k)}: ${value(e[k])}`).join(", "))
      .filter(Boolean);
    return `  {\n${lines.map((l) => `    ${l}`).join(",\n")}\n  }`;
  });
  return `[\n${body.join(",\n")}\n]\n`;
}

export async function readCatalog(file: string): Promise<MapEntry[]> {
  return JSON.parse(await readFile(file, "utf8")) as MapEntry[];
}

/** Inserts or updates one map's entry, keeping the others and their order; new maps go last. */
export function upsert(entries: MapEntry[], cfg: MapConfig, u: CatalogUpdate): MapEntry[] {
  const i = entries.findIndex((e) => e.id === cfg.id);
  const next = entryFor(cfg, entries[i], u);
  return i < 0 ? [...entries, next] : entries.map((e, k) => (k === i ? next : e));
}

export async function writeCatalog(file: string, entries: MapEntry[]): Promise<boolean> {
  const text = formatCatalog(entries);
  const old = await readFile(file, "utf8").catch(() => "");
  if (old === text) return false;
  await writeFile(file, text);
  return true;
}
