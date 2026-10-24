// Builds the data for configured maps, or scaffolds a new map config. See HELP below.

import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { resolveArea } from "./area";
import { checkMap, DATA_ROOT } from "./check";
import type { MapConfig, Network, Scope } from "./config";
import { loadConfigs, MAPS_DIR } from "./load";
import { entryFor, readCatalog, upsert, writeCatalog } from "./out/catalog";
import { configFor, ID, NETWORKS, renderConfig, SCOPES } from "./scaffold";
import type { CacheOptions } from "./sources/cache";
import { RUN, STAGES, type Stage, type StageContext } from "./stages";

export const HELP = `Usage:
  npm run fetch -- <id>... [options]       build configured maps (build/maps/<id>.ts)
  npm run fetch -- --all [options]         build every configured map
  npm run fetch -- new <id> --scope <scope> --network <network> [--area <area>] [options]
                                           write build/maps/<id>.ts; build it with the line above

Build options:
  --only <stage>     network, basemap or landmarks; may be repeated (default: all three)
  --offline          use the cache only; fail on anything not cached
  --refresh          ignore the cache and fetch everything again
  --dry-run          report what would happen, write nothing

New-map options:
  --scope <scope>    city, region, country, continent or world
  --network <net>    transit, rail, air or sea
  --area <area>      one of:
                       a bbox:            w,s,e,n            (9.1,48.7,9.3,48.85)
                       an ISO 3166 code:  DE, DE-BW          (looked up in OSM)
                       a continent code:  AF AN AS EU NA OC SA   (with --scope continent)
                       a place name:      "Karlsruhe, DE"    (looked up with Nominatim)
                     Not needed with --scope world.
                     Note: EU means Europe the continent, not the European Union.
                     There is no area for the union; give a bbox if that is what you want.
  --operator <name>  an airline or shipping company to follow; may be repeated
  --name <name>      display name (default: from the area, else from the id)
  --force            overwrite an existing config
  --dry-run          print the config instead of writing it

Cached answers live in .cache/fetch/. OVERPASS_URL picks another Overpass instance.
Exit codes: 0 ok, 1 a map failed, 2 bad arguments.
`;

export class UsageError extends Error {}

export type Command =
  | { cmd: "help" }
  | { cmd: "build"; ids: string[]; all: boolean; only: Stage[]; cache: CacheOptions; dryRun: boolean }
  | {
      cmd: "new"; id: string; scope: Scope; network: Network; area?: string; operators: string[];
      name?: string; force: boolean; cache: CacheOptions; dryRun: boolean;
    };

export function parseCli(argv: string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        all: { type: "boolean" },
        only: { type: "string", multiple: true },
        offline: { type: "boolean" },
        refresh: { type: "boolean" },
        "dry-run": { type: "boolean" },
        scope: { type: "string" },
        network: { type: "string" },
        area: { type: "string" },
        operator: { type: "string", multiple: true },
        name: { type: "string" },
        force: { type: "boolean" },
      },
    });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  const { values: v, positionals: pos } = parsed;
  if (v.help) return { cmd: "help" };
  if (v.offline && v.refresh) throw new UsageError("--offline and --refresh contradict each other");
  const cache: CacheOptions = { offline: v.offline, refresh: v.refresh };
  const dryRun = !!v["dry-run"];

  if (pos[0] === "new") {
    if (v.all || v.only) throw new UsageError("--all and --only are for building, not for new");
    const id = pos[1];
    if (!id) throw new UsageError("new needs an id: npm run fetch -- new <id> --scope ... --network ...");
    if (pos.length > 2) throw new UsageError(`new takes one id, got: ${pos.slice(1).join(" ")}`);
    if (!ID.test(id)) throw new UsageError(`"${id}" is not a valid id: use lowercase letters, digits and dashes`);
    if (!v.scope || !SCOPES.includes(v.scope as Scope)) throw new UsageError(`--scope must be one of ${SCOPES.join(", ")}`);
    if (!v.network || !NETWORKS.includes(v.network as Network)) throw new UsageError(`--network must be one of ${NETWORKS.join(", ")}`);
    if (!v.area && v.scope !== "world") throw new UsageError(`--area is needed for --scope ${v.scope}`);
    return {
      cmd: "new", id, scope: v.scope as Scope, network: v.network as Network, area: v.area,
      operators: v.operator ?? [], name: v.name, force: !!v.force, cache, dryRun,
    };
  }

  for (const k of ["scope", "network", "area", "operator", "name", "force"] as const) {
    if (v[k] !== undefined) throw new UsageError(`--${k} only goes with new`);
  }
  if (!v.all && !pos.length) throw new UsageError("Name at least one map, or pass --all. --help shows usage.");
  if (v.all && pos.length) throw new UsageError("Pass map ids or --all, not both");
  const only = (v.only ?? []).flatMap((s) => s.split(","));
  for (const s of only) if (!STAGES.includes(s as Stage)) throw new UsageError(`--only takes ${STAGES.join(", ")}; got "${s}"`);
  return { cmd: "build", ids: pos, all: !!v.all, only: only.length ? (only as Stage[]) : [...STAGES], cache, dryRun };
}

// ---- build ----

interface Outcome { id: string; ok: boolean; lines: string[] }

async function buildOne(cfg: MapConfig, cmd: Extract<Command, { cmd: "build" }>, today: string): Promise<Outcome> {
  const lines: string[] = [];
  const ctx: StageContext = { cfg, outDir: join(DATA_ROOT, cfg.id), cache: cmd.cache, dryRun: cmd.dryRun };
  const attribution = new Set<string>();
  let changed = false;
  try {
    for (const stage of cmd.only) {
      const r = await RUN[stage](ctx);
      lines.push(`${stage}: ${r.status}${r.note ? ` (${r.note})` : ""}`, ...(r.details ?? []).map((d) => `  ${d}`));
      r.attribution?.forEach((a) => attribution.add(a));
      changed ||= !!r.changed;
    }
  } catch (err) {
    return { id: cfg.id, ok: false, lines: [...lines, `error: ${(err as Error).message}`] };
  }

  const hasData = await access(join(ctx.outDir, "network.json")).then(() => true, () => false);
  const catalogFile = join(DATA_ROOT, "maps.json");
  const catalog = await readCatalog(catalogFile);
  const entry = entryFor(cfg, catalog.find((e) => e.id === cfg.id), { available: hasData, changed, today });
  const problems = hasData ? await checkMap(DATA_ROOT, entry, cfg) : [];
  if (problems.length) lines.push(...problems.map((p) => `check: ${p}`));
  else lines.push(hasData ? "check: ok" : "check: no data yet");

  if (!cmd.dryRun) {
    const next = upsert(catalog, cfg, {
      available: hasData && !problems.length, changed, today,
      attribution: attribution.size ? [...attribution].sort() : undefined,
    });
    lines.push(`catalog: ${(await writeCatalog(catalogFile, next)) ? "updated" : "unchanged"}`);
  }
  return { id: cfg.id, ok: !problems.length, lines };
}

async function build(cmd: Extract<Command, { cmd: "build" }>): Promise<number> {
  const configs = await loadConfigs();
  const unknown = cmd.ids.filter((id) => !configs.has(id));
  if (unknown.length) {
    console.error(`No config for: ${unknown.join(", ")}. Configured: ${[...configs.keys()].join(", ")}`);
    return 2;
  }
  const today = new Date().toISOString().slice(0, 10);
  const outcomes: Outcome[] = [];
  for (const cfg of cmd.all ? [...configs.values()] : cmd.ids.map((id) => configs.get(id)!)) {
    console.log(`${cfg.id}${cmd.dryRun ? " (dry run)" : ""}`);
    const o = await buildOne(cfg, cmd, today);
    o.lines.forEach((l) => console.log(`  ${l}`));
    outcomes.push(o);
  }
  const failed = outcomes.filter((o) => !o.ok).map((o) => o.id);
  console.log(`\n${outcomes.length - failed.length} of ${outcomes.length} ok${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
  return failed.length ? 1 : 0;
}

// ---- new ----

const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, "\\$1")}"`);

async function scaffold(cmd: Extract<Command, { cmd: "new" }>, argv: string[]): Promise<number> {
  const file = join(MAPS_DIR, `${cmd.id}.ts`);
  if (!cmd.force && !cmd.dryRun && (await access(file).then(() => true, () => false))) {
    console.error(`${file} exists already; pass --force to overwrite it`);
    return 1;
  }
  let area;
  try {
    area = cmd.area ? await resolveArea(cmd.area, cmd.scope === "continent", cmd.cache) : undefined;
  } catch (err) {
    console.error(`Could not resolve --area ${quote(cmd.area!)}: ${(err as Error).message}`);
    console.error("Pass a bbox (w,s,e,n) instead to skip the lookup.");
    return 1;
  }
  const cfg = configFor({ id: cmd.id, scope: cmd.scope, network: cmd.network, area, name: cmd.name, operators: cmd.operators });
  const text = renderConfig(cfg, `npm run fetch -- ${argv.filter((a) => a !== "--dry-run" && a !== "--force").map(quote).join(" ")}`, new Date().toISOString().slice(0, 10));
  if (cmd.dryRun) {
    console.log(`Would write ${file}:\n`);
    console.log(text);
    return 0;
  }
  await mkdir(MAPS_DIR, { recursive: true });
  await writeFile(file, text);
  console.log(`Wrote ${file}. Build it with: npm run fetch -- ${cmd.id}`);
  return 0;
}

// ---- main ----

export async function main(argv: string[]): Promise<number> {
  let cmd: Command;
  try {
    cmd = parseCli(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`${err.message}\n`);
    console.error(HELP);
    return 2;
  }
  if (cmd.cmd === "help") { console.log(HELP); return 0; }
  return cmd.cmd === "new" ? scaffold(cmd, argv) : build(cmd);
}

if (import.meta.filename === process.argv[1]) process.exitCode = await main(process.argv.slice(2));
