// Every network request goes through here: .cache/fetch/<source>/<sha256 of the key>.json.
// A cached answer is reused forever unless --refresh is given; --offline turns a miss into an error.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface CacheOptions {
  dir?: string;        // default .cache/fetch under the working directory
  offline?: boolean;   // never fetch; fail on a miss
  refresh?: boolean;   // ignore what is cached, fetch again and overwrite
}

interface Entry<T> { key: string; fetched: string; data: T }

export class CacheMiss extends Error {
  constructor(readonly source: string, readonly key: string) {
    super(`Not in the cache and --offline is set: ${source} ${key.length > 120 ? `${key.slice(0, 117)}...` : key}`);
  }
}

export const cachePath = (source: string, key: string, dir = join(".cache", "fetch")) =>
  join(dir, source, `${createHash("sha256").update(key).digest("hex")}.json`);

/** Returns the cached answer for `key`, or calls `fetch` and stores what it returns. */
export async function cached<T>(source: string, key: string, fetch: () => Promise<T>, opts: CacheOptions = {}): Promise<T> {
  const file = cachePath(source, key, opts.dir);
  if (!opts.refresh) {
    const hit = await readFile(file, "utf8").then((s) => JSON.parse(s) as Entry<T>, () => null);
    if (hit) return hit.data;
  }
  if (opts.offline) throw new CacheMiss(source, key);
  const data = await fetch();
  const entry: Entry<T> = { key, fetched: new Date().toISOString(), data };
  await mkdir(dirname(file), { recursive: true });
  // Write then rename, so an interrupted run never leaves half a file that later reads as a hit.
  await writeFile(`${file}.tmp`, JSON.stringify(entry));
  await rename(`${file}.tmp`, file);
  return data;
}

export const USER_AGENT = "transit-evolution-fetch/0.1 (+https://github.com/philipptempel/transit-map-visualizer)";

/** fetch() with our User-Agent that throws on anything but a 2xx answer. */
export async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url}: ${res.status} ${res.statusText}`);
  return res;
}
