// Map configs live in build/maps/<id>.ts, one default export each.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { MapConfig } from "./config";

export const MAPS_DIR = join(import.meta.dirname, "maps");

export async function loadConfigs(dir = MAPS_DIR): Promise<Map<string, MapConfig>> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort();
  const out = new Map<string, MapConfig>();
  for (const f of files) {
    const cfg = ((await import(pathToFileURL(join(dir, f)).href)) as { default: MapConfig }).default;
    if (cfg.id !== f.slice(0, -3)) throw new Error(`${f}: id is "${cfg.id}", but the file name says "${f.slice(0, -3)}"`);
    out.set(cfg.id, cfg);
  }
  return out;
}
