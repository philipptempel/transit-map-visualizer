// `fetch new`: writes build/maps/<id>.ts from the command line, so every map has a config
// that rebuilds it instead of a one-off command in someone's shell history.

import type { Area } from "./area";
import type { MapConfig, Network, Operator, Profile, Scope } from "./config";

export const SCOPES: Scope[] = ["city", "region", "country", "continent", "world"];
export const NETWORKS: Network[] = ["transit", "rail", "air", "sea"];
export const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Placeholders, to tell operators apart until someone picks their real colours.
const OPERATOR_COLORS = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf", "#8c564b", "#e377c2"];

export function defaultProfile(scope: Scope, network: Network): Profile {
  if (network === "air" || network === "sea") return network;
  if (network === "rail") {
    if (scope === "continent" || scope === "world") return "continental-rail";
    return scope === "country" ? "national-rail" : "local-plus-regional";
  }
  return scope === "city" ? "local" : "local-plus-regional";
}

const WORLD: Area = { bbox: [-180, -85, 180, 85] };

export interface NewMap {
  id: string; scope: Scope; network: Network;
  area?: Area;              // resolved --area; the world when absent
  name?: string;
  operators?: string[];
}

export function configFor(m: NewMap): MapConfig {
  const area = m.area ?? WORLD;
  const operators = m.operators?.map((name, i): Operator => ({ name, color: OPERATOR_COLORS[i % OPERATOR_COLORS.length] }));
  return {
    id: m.id,
    name: m.name ?? area.name ?? m.id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "),
    scope: m.scope, network: m.network,
    ...(area.continent && { continent: area.continent }),
    ...(area.country && { country: area.country }),
    ...(area.state && { state: area.state }),
    bbox: area.bbox,
    clip: "bbox",
    profile: defaultProfile(m.scope, m.network),
    ...(operators?.length && { operators }),
    ...(m.scope === "world" && { projection: "equalEarth" as const }),
  };
}

// Catalog fields that make sense per scope; the ones still empty get a reminder in the file.
const EXPECTED: Record<Scope, ("continent" | "country" | "state")[]> = {
  city: ["continent", "country", "state"], region: ["continent", "country", "state"],
  country: ["continent", "country"], continent: ["continent"], world: [],
};

const str = JSON.stringify;
const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** The config as a TypeScript module, in the style of the hand-written ones. */
export function renderConfig(cfg: MapConfig, command: string, today: string): string {
  const missing = EXPECTED[cfg.scope].filter((k) => !cfg[k]);
  const lines = [
    `import type { MapConfig } from "../config";`,
    ``,
    `// Scaffolded ${today} by: ${command}`,
    `// Check the bbox. Add overrides once the data is in and shows what needs them.`,
    `export default {`,
    `  id: ${str(cfg.id)}, name: ${str(cfg.name)}, scope: ${str(cfg.scope)}, network: ${str(cfg.network)},`,
  ];
  const where = (["continent", "country", "state"] as const).filter((k) => cfg[k]).map((k) => `${k}: ${str(cfg[k])}`);
  if (where.length) lines.push(`  ${where.join(", ")},`);
  if (missing.length) lines.push(`  // Not resolved; fill in for the catalog filters: ${missing.join(", ")}`);
  lines.push(`  bbox: [${cfg.bbox.map(round).join(", ")}],`);
  lines.push(`  clip: ${str(cfg.clip)}, profile: ${str(cfg.profile)},`);
  if (cfg.operators?.length) {
    lines.push(`  operators: [   // colours are placeholders; add predecessors with from/to`);
    for (const o of cfg.operators) lines.push(`    { name: ${str(o.name)}, color: ${str(o.color)} },`);
    lines.push(`  ],`);
  }
  if (cfg.projection) lines.push(`  projection: ${str(cfg.projection)},`);
  lines.push(`} satisfies MapConfig;`, ``);
  return lines.join("\n");
}
