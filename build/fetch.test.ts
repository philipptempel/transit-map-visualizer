import { describe, expect, it } from "vitest";
import { HELP, parseCli, UsageError } from "./fetch";
import { configFor, renderConfig } from "./scaffold";
import { parseBBox, resolveArea } from "./area";

describe("parseCli", () => {
  it("parses builds", () => {
    expect(parseCli(["stuttgart", "nantes", "--only", "network", "--offline"])).toEqual({
      cmd: "build", ids: ["stuttgart", "nantes"], all: false, only: ["network"],
      cache: { offline: true, refresh: undefined }, dryRun: false,
    });
    expect(parseCli(["--all"])).toMatchObject({ cmd: "build", all: true, only: ["network", "basemap", "landmarks"] });
  });

  it("parses new", () => {
    expect(parseCli(["new", "klm", "--scope", "world", "--network", "air", "--operator", "KLM", "--operator", "Martinair"]))
      .toMatchObject({ cmd: "new", id: "klm", scope: "world", network: "air", area: undefined, operators: ["KLM", "Martinair"] });
  });

  it.each([
    [[], /at least one map/],
    [["--all", "stuttgart"], /not both/],
    [["stuttgart", "--offline", "--refresh"], /contradict/],
    [["stuttgart", "--only", "tiles"], /--only takes/],
    [["stuttgart", "--scope", "city"], /only goes with new/],
    [["stuttgart", "--bogus"], /Unknown option/],
    [["new", "Bad_Id", "--scope", "city", "--network", "transit", "--area", "1,2,3,4"], /not a valid id/],
    [["new", "x", "--scope", "planet", "--network", "transit"], /--scope must be/],
    [["new", "x", "--scope", "city", "--network", "transit"], /--area is needed/],
  ])("rejects %j", (argv, msg) => {
    expect(() => parseCli(argv)).toThrow(UsageError);
    expect(() => parseCli(argv)).toThrow(msg);
  });

  it("explains in --help that EU is the continent", () => {
    expect(HELP).toMatch(/EU means Europe the continent, not the European Union/);
  });
});

describe("area", () => {
  it("parses a bbox and rejects nonsense", () => {
    expect(parseBBox("9.1,48.7,9.3,48.85")).toEqual([9.1, 48.7, 9.3, 48.85]);
    expect(parseBBox("9.3,48.7,9.1,48.85")).toBeNull();   // west of east
    expect(parseBBox("9.1,48.7,9.3")).toBeNull();
    expect(parseBBox("Karlsruhe")).toBeNull();
  });

  it("treats a two-letter area as a continent only with --scope continent", async () => {
    expect(await resolveArea("EU", true)).toMatchObject({ continent: "Europe" });
    await expect(resolveArea("XX", true)).rejects.toThrow(/Unknown continent/);
  });
});

describe("scaffold", () => {
  it("writes a config with defaults for the scope and network", () => {
    const cfg = configFor({ id: "eu-rail", scope: "continent", network: "rail", area: { bbox: [-25, 34, 60, 72], name: "Europe", continent: "Europe" } });
    expect(cfg).toMatchObject({ name: "Europe", profile: "continental-rail", continent: "Europe", clip: "bbox" });
    const world = configFor({ id: "british-airways", scope: "world", network: "air", operators: ["British Airways"] });
    expect(world).toMatchObject({ name: "British Airways", profile: "air", projection: "equalEarth", bbox: [-180, -85, 180, 85] });
    expect(world.operators).toEqual([{ name: "British Airways", color: expect.stringMatching(/^#/) }]);
  });

  it("renders a module that names what is still missing", () => {
    const text = renderConfig(configFor({ id: "test", scope: "city", network: "transit", area: { bbox: [9.1, 48.7, 9.3, 48.85] } }), "npm run fetch -- new test", "2026-10-24");
    expect(text).toContain(`id: "test", name: "Test", scope: "city", network: "transit",`);
    expect(text).toContain("fill in for the catalog filters: continent, country, state");
    expect(text).toContain("bbox: [9.1, 48.7, 9.3, 48.85],");
    expect(text).toMatch(/} satisfies MapConfig;\n$/);
  });
});
