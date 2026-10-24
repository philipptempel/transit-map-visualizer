import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OsmIndex, type OsmResponse } from "../sources/osm";

export const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, name), "utf8")) as OsmResponse;
export const demostadt = () => new OsmIndex(fixture("overpass-demostadt.json").elements);
