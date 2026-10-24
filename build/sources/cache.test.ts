import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheMiss, cached, cachePath } from "./cache";

describe("cached", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fetch-cache-")); });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("fetches once, then answers from the cache", async () => {
    const fetch = vi.fn(async () => ({ n: 1 }));
    expect(await cached("src", "q", fetch, { dir })).toEqual({ n: 1 });
    expect(await cached("src", "q", fetch, { dir })).toEqual({ n: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(await readFile(cachePath("src", "q", dir), "utf8"));
    expect(stored).toMatchObject({ key: "q", data: { n: 1 } });
  });

  it("fails on a miss when offline, and never calls fetch", async () => {
    const fetch = vi.fn(async () => 1);
    await expect(cached("src", "q", fetch, { dir, offline: true })).rejects.toBeInstanceOf(CacheMiss);
    expect(fetch).not.toHaveBeenCalled();
    await cached("src", "q", fetch, { dir });
    expect(await cached("src", "q", fetch, { dir, offline: true })).toBe(1);
  });

  it("fetches again on refresh and overwrites", async () => {
    let n = 0;
    const fetch = async () => ++n;
    await cached("src", "q", fetch, { dir });
    expect(await cached("src", "q", fetch, { dir, refresh: true })).toBe(2);
    expect(await cached("src", "q", fetch, { dir })).toBe(2);
  });

  it("keeps nothing when the fetch fails", async () => {
    await expect(cached("src", "q", async () => { throw new Error("down"); }, { dir })).rejects.toThrow("down");
    await expect(cached("src", "q", async () => 0, { dir, offline: true })).rejects.toBeInstanceOf(CacheMiss);
  });
});
