import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MapEntry } from "../../src/schema";
import type { MapConfig } from "../config";
import { entryFor, formatCatalog, upsert } from "./catalog";

const cfg: MapConfig = {
  id: "x", name: "X", scope: "city", network: "transit", continent: "Europe", country: "DE",
  bbox: [1, 2, 3, 4], clip: "bbox", profile: "local",
};
const today = "2026-10-24";

describe("entryFor", () => {
  it("leaves a map without data planned and undated", () => {
    expect(entryFor(cfg, undefined, { available: false, changed: false, today })).toEqual({
      id: "x", name: "X", bbox: [1, 2, 3, 4], type: "local", network: "transit",
      continent: "Europe", country: "DE", status: "planned",
    });
  });

  it("dates a map when its data arrives, and keeps the creation date afterwards", () => {
    const first = entryFor(cfg, undefined, { available: true, changed: true, today, attribution: ["© OpenStreetMap contributors"] });
    expect(first).toMatchObject({ created: today, updated: today, status: "available", attribution: ["© OpenStreetMap contributors"] });
    const later = entryFor(cfg, first, { available: true, changed: false, today: "2027-01-01" });
    expect(later).toMatchObject({ created: today, updated: today, attribution: ["© OpenStreetMap contributors"] });
  });

  it("maps scopes to catalog types", () => {
    expect(entryFor({ ...cfg, scope: "continent" }, undefined, { available: false, changed: false, today }).type).toBe("continental");
    expect(entryFor({ ...cfg, scope: "world" }, undefined, { available: false, changed: false, today }).type).toBe("global");
  });
});

describe("formatCatalog", () => {
  it("reproduces the committed maps.json byte for byte", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "..", "public", "data", "maps.json"), "utf8");
    expect(formatCatalog(JSON.parse(text) as MapEntry[])).toBe(text);
  });

  it("keeps other entries and their order on upsert", () => {
    const list = [{ id: "a" }, { id: "x" }, { id: "b" }] as MapEntry[];
    expect(upsert(list, cfg, { available: false, changed: false, today }).map((e) => e.id)).toEqual(["a", "x", "b"]);
    expect(upsert(list.slice(0, 1), cfg, { available: false, changed: false, today }).map((e) => e.id)).toEqual(["a", "x"]);
  });
});
