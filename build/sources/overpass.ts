// Overpass API client: one request at a time, backing off on 429 and 504, every answer cached.
// OVERPASS_URL points it at another instance (a mirror, or a local one for country-sized queries).

import { cached, request, type CacheOptions } from "./cache";
import type { OsmResponse } from "./osm";

export const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

let queue: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(endpoint: string, query: string): Promise<OsmResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await request(endpoint, { method: "POST", body: new URLSearchParams({ data: query }) });
      return (await res.json()) as OsmResponse;
    } catch (err) {
      const busy = /: (429|504) /.test(String(err));
      if (!busy || attempt >= 4) throw err;
      await sleep(5000 * 2 ** attempt);
    }
  }
}

/** Runs an Overpass QL query ([out:json] is up to the caller), or answers it from the cache. */
export function overpass(query: string, opts: CacheOptions & { endpoint?: string } = {}): Promise<OsmResponse> {
  const endpoint = opts.endpoint ?? OVERPASS_URL;
  return cached("overpass", query, () => {
    const run = queue.then(() => post(endpoint, query));
    queue = run.catch(() => undefined);
    return run;
  }, opts);
}
