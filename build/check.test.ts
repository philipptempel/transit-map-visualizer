import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NetworkFile } from "../src/schema";
import { checkAll, checkNetwork, dateValue, DATA_ROOT } from "./check";

describe("dateValue", () => {
  it("reads every date form the renderer accepts", () => {
    expect(dateValue("1985")).toBe(1985);
    expect(dateValue(1985.5)).toBe(1985.5);
    expect(dateValue(null)).toBeNull();
    expect(dateValue("1985-02-30")).toBeNaN();
    expect(dateValue("85")).toBeNaN();
  });
});

describe("check-data", () => {
  it("passes on the shipped data", async () => {
    expect(await checkAll()).toEqual([{ id: "demostadt", problems: [] }]);
  });

  describe("on a deliberately broken copy of Demostadt", () => {
    let root: string, net: NetworkFile;
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "check-data-"));
      await cp(join(DATA_ROOT, "demostadt"), join(root, "data", "demostadt"), { recursive: true });
      await cp(join(DATA_ROOT, "maps.json"), join(root, "data", "maps.json"));
      net = JSON.parse(await readFile(join(DATA_ROOT, "demostadt", "network.json"), "utf8")) as NetworkFile;
    });
    afterEach(() => rm(root, { recursive: true, force: true }));

    const problems = async (n: NetworkFile) => {
      await writeFile(join(root, "data", "demostadt", "network.json"), JSON.stringify(n));
      return (await checkAll(join(root, "data"))).flatMap((r) => r.problems);
    };

    it("finds unknown stops and lines", async () => {
      net.segments[0].to = "nowhere";
      net.segments[1].lines = ["d-404"];
      expect(await problems(net)).toEqual([
        'segment 0 (hf → nowhere): no stop "nowhere"',
        'segment 1 (mk → dm): no line "d-404"',
      ]);
    });

    it("finds bad dates and segments that end before they start", async () => {
      net.segments[0].start = "1965-13";
      net.segments[2].start = "1990";
      net.stops[0].end = "yesterday";
      expect(await problems(net)).toEqual([
        'stop wp: end "yesterday" is not a date',
        'segment 0 (hf → mk): start "1965-13" is not a date',
        "segment 2 (hf → wf): starts (1990) after it ends (1988)",
      ]);
    });

    it("finds swapped coordinates and modes no group draws", async () => {
      net.stops[0].geo = [net.stops[0].geo[1], 52.1];
      net.segments[0].mode = "funicular";
      expect(await problems(net)).toEqual([
        "stop wp: [0.128, 52.1] lies outside the map's bbox",
        'segment 0 (hf → mk): mode "funicular" is in no group, so it would not be drawn',
      ]);
    });

    it("finds a network.json over its size budget", async () => {
      net.stops[0].name = "x".repeat(1.6 * 1024 * 1024);
      expect(await problems(net)).toEqual([expect.stringMatching(/^network\.json is 1\.6\d MB, over the 1\.5 MB budget/)]);
    });

    it("finds a broken landmark and a missing base map file", async () => {
      await writeFile(join(root, "data", "demostadt", "landmarks.json"), JSON.stringify([{ name: "Tower", geo: [0.1, 0.1], anchor: "zz" }]));
      await writeFile(join(root, "data", "demostadt", "basemap", "index.json"),
        JSON.stringify({ current: { url: "data/demostadt/basemap/current.json", source: "test" }, snapshots: [] }));
      expect(checkNetwork(net)).toEqual([]);
      expect(await problems(net)).toEqual([
        'landmarks.json: landmark Tower: anchor "zz" is no stop',
        "basemap/index.json: data/demostadt/basemap/current.json does not exist",
      ]);
    });

    it("flags an available map without data", async () => {
      await rm(join(root, "data", "demostadt", "network.json"));
      expect((await checkAll(join(root, "data"))).flatMap((r) => r.problems)).toEqual(["network.json is missing"]);
    });
  });
});
