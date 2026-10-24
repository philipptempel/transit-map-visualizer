import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NetworkFile } from "../../src/schema";
import { fixture } from "../__fixtures__/load";
import { checkDetail, checkNetwork } from "../check";
import type { MapConfig } from "../config";
import { cachePath } from "../sources/cache";
import { RUN } from ".";
import { routesQuery } from "./network";

const cfg: MapConfig = {
  id: "demo", name: "Demo", scope: "city", network: "transit",
  bbox: [0, 0.02, 0.3, 0.28], clip: "bbox", profile: "local", sBahnLike: [{ ref: /^S\d+$/ }],
};

// The network stage end to end, offline, from the fixture planted in a cache as Overpass's answer.
describe("network stage", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "stage-"));
    const file = cachePath("overpass", routesQuery(cfg.bbox), join(dir, "cache"));
    await mkdir(dirname(file), { recursive: true });
    const data = { ...fixture("overpass-demostadt.json"), osm3s: { timestamp_osm_base: "2026-10-24T16:08:49Z" } };
    await writeFile(file, JSON.stringify({ key: routesQuery(cfg.bbox), fetched: "test", data }));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const run = () => RUN.network({ cfg, outDir: join(dir, "out"), cache: { dir: join(dir, "cache"), offline: true }, dryRun: false });

  it("writes network.json and network.detail.json that pass the checks", async () => {
    const r = await run();
    expect(r).toMatchObject({ status: "done", changed: true, attribution: ["© OpenStreetMap contributors"] });
    expect(r.note).toMatch(/MB \+ .* MB detail, OSM data of 2026-10-24T16:08:49Z$/);
    const net = JSON.parse(await readFile(join(dir, "out", "network.json"), "utf8")) as NetworkFile;
    const detail = JSON.parse(await readFile(join(dir, "out", "network.detail.json"), "utf8")) as { segments: unknown[] };
    expect(net.groups.every((g) => g.coverage?.from === "2026")).toBe(true);
    expect(checkNetwork(net, { bounds: cfg.bbox })).toEqual([]);
    expect(checkDetail(detail, net, { bounds: cfg.bbox })).toEqual([]);
  });

  it("reproduces both files byte for byte from the cache", async () => {
    const before = await readFile(join(dir, "out", "network.json"), "utf8");
    expect((await run()).changed).toBe(false);
    expect(await readFile(join(dir, "out", "network.json"), "utf8")).toBe(before);
  });
});
