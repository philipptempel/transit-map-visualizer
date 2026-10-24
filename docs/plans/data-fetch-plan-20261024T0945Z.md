# Plan: a fetch script that builds map data

Written 2026-10-24, against `claude/add-transit-evolution` at `4cf0ca5`.
Meant to be picked up cold by a separate session. Section 10 has the prompt
for that session.

## 1. Goal

One command builds everything a map needs under `public/data/<id>/`
(`network.json`, `basemap/`, `landmarks.json`) and marks it `available` in
`public/data/cities.json`. Two arguments describe the map:

- **scope**: `city`, `region`, `country` (plus `world` for airlines and
  cruise lines, which don't belong to one area)
- **network**: `transit` (tram, metro, bus, ferry…), `rail`, `air`, `sea`

Not goals, for now:

- Running the fetch in CI. Data is fetched locally, reviewed, committed.
- Historical base maps. The basemap index already supports them; nobody fills them yet.
- A real schematic layout. Section 7 says why it waits.

## 2. What already exists (use it, don't rebuild it)

- `build/config.ts`:
  - `CityConfig` per map: bbox, `clip`, inclusion `profile`, `sBahnLike`, `overrides`
  - `PROFILES` (`local`, `local-plus-regional`, `national-rail`)
  - `DEFAULT_GROUPS`
  - Five configured maps: nantes, stuttgart, den-haag, rotterdam, france-rail
- `build/classify.ts`: `classify(RouteInfo, city)` maps OSM route tags or a
  GTFS `route_type` to a `Mode`. `included(mode, city)` applies the profile.
  Untested against real data. The comment in config.ts says so.
- `src/schema.ts`: `NetworkFile`, `Stop`, `Segment`, `Line`, `GroupDef`
  (with `coverage.from`), `BasemapIndex`, `Landmark`, `CityEntry`. This is the
  output contract. The renderer plugins in `src/plugins/` read exactly this.
- `build/pages.ts`: emits `map/<id>.html` for every catalog entry that isn't
  `planned`. Flipping `status` is all a new map needs to get a page.
- `public/data/demostadt/`: a hand-written example of every file.

Renderer facts the output has to respect (`src/plugins/network.ts`):

- `segment.geo` is optional; without it the segment is a straight line
  between its two stops. `schem` falls back to `geo`.
- A segment's `mode` picks its group. A mode no group lists is silently dropped.
- The year range is the union of all `start`/`end` dates. With no dates at
  all it becomes 1900 to now, which looks broken. Set `coverage.from` instead
  of leaving everything undated.
- **Quirk:** segments are flipped so `from < to` (string compare), and growth
  always runs from index 0. A line extension therefore "grows" from whichever
  stop id sorts first, which may be the new far end. Fix it in the renderer
  (Phase 0): remember the flip and cut from the other end.

## 3. Hard truths, before anyone writes code

**History is the whole difficulty.** OpenStreetMap describes today's network.
Dates are scattered:

- OSM: `start_date` tags here and there; lifecycle tags (`railway=abandoned`,
  `disused:railway=*`, `razed:*`) for some closed lines, rarely dated.
- OpenHistoricalMap: the same tag model with real `start_date`/`end_date`.
  Coverage is patchy: good for a few cities, empty for many.
- Wikidata: stations often have opening (P1619) and closure (P3999) dates, and
  OSM stations often carry a `wikidata=Q…` tag to join on. Lines less so.
  Route changes (line 4 rerouted in 1987) almost never.

So the pipeline produces the current network plus partial dates, and a
hand-curated overrides file per map does the rest. I'd rather say that
up front than pretend a script will reconstruct 1960. `coverage.from` per
group is how the UI admits where the data stops.

**Air and sea have no free history at all.**

- OpenFlights `routes.dat` is a single 2014 snapshot.
- OurAirports has airports, not routes.
- Historical airline networks live in Wikipedia destination tables (with
  "terminated" notes) and paid OAG data.
- Cruise itineraries live on operators' websites, whose terms usually forbid scraping.

For both, the script should *build geometry from a curated CSV*, not *discover routes*.

**Licensing.** OSM and OpenHistoricalMap data are ODbL. OpenFlights is ODbL
too. A `network.json` derived from them is a derived database, so it has to:

- show "© OpenStreetMap contributors" on the map page
- be offered under ODbL

That is separate from the GPL on the code. Wikidata is CC0, Natural Earth is
public domain, OurAirports is public domain. Phase 0 adds an `attribution`
field and `public/data/LICENSE.md`.

**Network access.** Tested from the planning session on 2026-10-24:

| Host | Needed for | Reachable |
| --- | --- | --- |
| `overpass-api.de` | OSM routes, stops, base map (city) | **no** |
| `overpass-api.openhistoricalmap.org` | historical lines | **no** |
| `query.wikidata.org`, `www.wikidata.org` | station dates | **no** |
| `nominatim.openstreetmap.org` | resolving `--area "Karlsruhe"` | **no** (optional) |
| `download.geofabrik.de` | PBF extracts, only if France times out on Overpass | **no** (optional) |
| `raw.githubusercontent.com` | Natural Earth, OurAirports, OpenFlights | yes |

The first three have to be added to the environment's allowed domains before
Phase 1. Settings: the cloud environment menu in the session's title bar, then
Edit, then Network access
(<https://code.claude.com/docs/en/cloud-environments#network-access>).
Without them, Phase 0 still works because it needs no network.

## 4. The command

`node:util`'s `parseArgs` is enough, so there is no CLI dependency. Run it
with `tsx`, which is already a devDependency.

```sh
npm run fetch -- stuttgart                      # build one configured map
npm run fetch -- stuttgart nantes               # several
npm run fetch -- --all
npm run fetch -- stuttgart --only network       # network | basemap | landmarks
npm run fetch -- stuttgart --offline            # cache only; fail on a miss
npm run fetch -- stuttgart --refresh            # ignore the cache
npm run fetch -- stuttgart --dry-run            # report, write nothing

# scaffold a new map config, then build it with the line above
npm run fetch -- new karlsruhe --scope city    --network transit --area "Karlsruhe, DE"
npm run fetch -- new de-rail   --scope country --network rail    --area DE
npm run fetch -- new nl-air    --scope country --network air     --area NL    # domestic flights
npm run fetch -- new lh        --scope world   --network air     --operator "Lufthansa"
```

I'd keep "build" and "scaffold" apart on purpose. Every committed map then has
a config file that reproduces it, instead of a one-off command line in someone's
shell history.

Mapping onto what exists:

| `--scope` | `MapType` in catalog | default profile |
| --- | --- | --- |
| `city` | `local` | `local` (transit) |
| `region` | `regional` | `local-plus-regional` |
| `country` | `national` | `national-rail` for `rail` |
| `world` | `global` (new) | n/a |

`--area` accepts an ISO 3166-1/-2 code (`DE`, `DE-BW`), a place name (resolved
via Nominatim, or via an Overpass admin-boundary lookup if Nominatim stays
blocked), or a literal bbox `w,s,e,n`. `new` writes the resolved bbox into the
config so later builds never depend on the lookup again.

Exit codes: 0 ok, 1 a map failed, 2 bad arguments. One failed map doesn't stop
the others. The script prints a summary at the end.

## 5. Layout and stages

```
build/
  fetch.ts              CLI entry: parse args, run stages per map, summary
  maps/<id>.ts          one config per map: export default {...} satisfies MapConfig
  config.ts             types, PROFILES, DEFAULT_GROUPS (CITIES array goes away)
  classify.ts           unchanged API; gains air/sea modes later
  sources/
    cache.ts            .cache/fetch/<source>/<sha256>.json, offline/refresh
    overpass.ts         queries + rate limiting (one at a time, back off on 429)
    ohm.ts              same, against OpenHistoricalMap
    wikidata.ts         batched SPARQL (VALUES of ≤200 QIDs), User-Agent set
    naturalearth.ts     land/lakes/rivers/admin from raw.githubusercontent.com
  graph/
    stops.ts            dedupe: stop_area relation, else same name within ~300 m
    segments.ts         route → ordered stops → consecutive pairs; slice geometry
    dates.ts            merge date evidence, record where each date came from
    simplify.ts         Douglas–Peucker + coordinate rounding per scope
  out/
    network.ts, basemap.ts, landmarks.ts, catalog.ts   write + update cities.json
  check.ts              validator, also run in CI (npm run check-data)
overrides/<id>.json     hand-curated dates, closed lines, renames, with sources
.cache/                 gitignored
```

Per map, the stages run in order: resolve config → fetch (cached) → normalise
to `RouteInfo` and stop records → `classify` + `included` → build graph →
merge dates → apply overrides → simplify → write → validate → update catalog.

Date precedence, highest first: overrides → OpenHistoricalMap → Wikidata → OSM
tags → unknown. Every dated thing keeps a `src` (the field exists on `Segment`
already; add it to `Stop`). Undated segments get no `start`, and the group's
`coverage.from` is set to the earliest year the dated data actually supports.
Never guess a date to make the animation prettier.

Size budget (raw JSON, before gzip): a city `network.json` under 1.5 MB, a
national one under 5 MB.

- Round coordinates to 5 decimals for a city, 3 for a country.
- Simplify to about 5 m for a city, 200 m for a country.
- `mapshaper` (npm, 0.7.x) does simplify and clip for base maps.

## 6. Sources per network

**transit / rail.**

- Overpass for route relations: `route=tram|light_rail|subway|monorail|train|bus|trolleybus|ferry|funicular|aerialway`.
- Overpass for their `route_master`, members with roles `stop`/`platform`,
  `stop_area` relations, and `railway=station|halt`. Fetch the `wikidata` tag too.
- `clip: "bbox"` cuts geometry at the bbox. `"whole-line"` keeps any route touching it.
- Closed lines: OSM lifecycle-tagged ways plus OHM. Where neither has
  geometry, use a straight segment marked `src: "inferred"`.

**Base map.**

- City: OSM water, parks/forest and major roads from Overpass, clipped and
  simplified, as `basemap/current.json` with `kind` per feature.
- Country and world: Natural Earth (10 m for a country, 50 m for the world).

**Landmarks.** Optional, and last: a few Wikidata items in the bbox with a
date (cathedral, stadium, airport). Skip it entirely if it turns into a rabbit hole.

**air.**

- Airports: OurAirports `airports.csv` (IATA, coordinates).
- Current routes: OpenFlights as a starting point, clearly labelled as 2014.
- History: `overrides/<id>.csv` with `from,to,operator,start,end,src`.
- Geometry: great circles at build time (`geoInterpolate` from d3-geo, about
  32 points), split at the antimeridian.

**sea.**

- Ports: World Port Index (NGA, public domain) or Wikidata.
- Itineraries: a curated CSV.
- Paths around land: `searoute-js` exists, but its last publish was 2022 and
  it's at 0.1.0, so check it still works before relying on it. If it doesn't,
  ship straight segments for v1.

## 7. Schema and renderer changes

- `Mode`: add `flight`, `cruise`.
- `MapType`: add `global`.
- `CityEntry` and `CityConfig`: add `network: "transit" | "rail" | "air" | "sea"`.
  The landing page gets a matching filter in `MapCatalog.tsx`, next to type.
- `CityEntry`: add `attribution: string[]`. The map page shows it.
- `CityEntry`: add `projection?: "mercator" | "equalEarth"`. `createRenderer`
  hard-codes `geoMercator` today. A world airline map needs the option.
  It's Phase 4 work, but the field can land early.
- `Stop`: add `src?: string`.
- Renderer: the growth-direction fix from section 2.
- Naming: `CityEntry`, `CityConfig` and `cities.json` already hold
  "France (rail)" and will hold airlines. I'd rename them to `MapEntry`,
  `MapConfig` and `maps.json` in Phase 0, while there are six entries and one
  reader. Doing it later costs more. The user should confirm.

Schematic layout waits because it's a research problem, not a script.

- LOOM from the University of Freiburg (`ad-freiburg/loom`) produces octilinear
  transit maps from GeoJSON. It's C++ and needs building.
- One layout for the final network can then serve every year.
- Until then, `schem` stays absent and the geo/schematic toggle simply does nothing for real maps.

## 8. Phases

Each phase is one PR. Branch from the latest default branch once PR #1 is
merged. Until then, branch from `claude/add-transit-evolution`.

### Phase 0: groundwork (no network needed)

- `build/fetch.ts` with argument parsing, `--help`, map selection and the summary.
  Stages are stubs except for writing the catalog.
- Move `CITIES` to `build/maps/<id>.ts`. `new` writes such a file from a template.
- `sources/cache.ts`. Add `.cache/` to `.gitignore`.
- Schema additions from section 7, the renderer growth fix, and the
  attribution line on the map page.
- `build/check.ts` checks:
  - every `from`, `to` and line id exists
  - dates parse and `start ≤ end`
  - coordinates sit within the bbox plus a margin
  - every segment mode is in some group
  - file sizes are within budget
- Add `check-data` to `package.json` and `mise.toml`, and run it in both CI
  configs before the build.
- Tests: add `vitest` (it fits Vite) for `classify`, stop dedupe, segment
  building and date merging, using small fixture Overpass responses committed
  under `build/__fixtures__/`.
- `public/data/LICENSE.md` (ODbL for derived data) and a README section on data sources.

Done when:

- `npm run fetch -- --help` prints usage.
- `npm run fetch -- new test --scope city --network transit --area 9.1,48.7,9.3,48.85 --dry-run`
  prints the config it would write.
- `npm run check-data` passes on Demostadt and fails on a broken copy.
- typecheck, tests and build are green in CI.

### Phase 1: today's network, one city (Stuttgart)

Stuttgart first: dense OSM tagging, `wikidata` tags on stations, and the
rack railway and funicular overrides exercise `classify`.

- Overpass fetch, graph build, geometry slicing, simplification, base map from OSM.
- No history yet. Set `coverage.from` to the current year so the UI is honest.
- Check the `overrides` in `build/maps/stuttgart.ts` against what the data
  actually says, and fix them.

Done when:

- `npm run fetch -- stuttgart` produces data within budget.
- The map page opens at `map/stuttgart.html` with lines in the right colours.
- `check-data` passes, and a second run with `--offline` gives identical output.

### Phase 2: history

- Wikidata dates (joined via OSM `wikidata` tags), OHM lines, OSM lifecycle
  tags, and `overrides/stuttgart.json`.
- A coverage report per group: share of segments and stops with a dated
  `start`, by source.
- Spot-check five milestones against Wikipedia, chosen by the session (not
  taken from this plan), and list them in the PR.

### Phase 3: the other configured maps

- Nantes, Rotterdam.
- Den Haag: `whole-line` must keep RandstadRail E to Rotterdam.
- France rail, national: chunk the Overpass queries by region, Natural Earth
  base map. Move to a Geofabrik PBF only if Overpass can't cope.

### Phase 4: air

- Per-map projection in the renderer.
- `flight` mode and groups.
- OurAirports and the OpenFlights snapshot, plus a curated CSV.
- Great circles.
- One example map, for an airline the user picks.

### Phase 5: sea

Ports, a curated itinerary CSV and sea routing, with one example.

## 9. Decisions for the user

1. **Rename `cities` to `maps`** (section 7). I'd say yes, in Phase 0.
2. **Is `world` a fourth scope?** Airlines need it. Or is scope implied by `--operator`?
3. **Which airline and cruise line** for the Phase 4/5 examples.
4. **Overpass instance.** The public `overpass-api.de` is fine for cities.
   For France, a mirror or a local Overpass/osmium setup would be kinder.
5. **Are curated overrides committed?** I'd keep them in the repo, every entry with a source URL.

## 10. Prompt for the new session

Before starting it:

- Add `overpass-api.de`, `overpass-api.openhistoricalmap.org`,
  `query.wikidata.org` and `www.wikidata.org` to the environment's allowed domains.
- Answer at least decision 1 in section 9.

> Work in philipptempel/transit-map-visualizer. Read
> `docs/plans/data-fetch-plan-20261024T0945Z.md` on branch
> `claude/add-transit-evolution` first; it is the spec.
>
> Implement **Phase 0 and Phase 1** only. Create the branch
> `claude/data-fetch`: from the default branch if PR #1 is merged, otherwise
> from `claude/add-transit-evolution`.
>
> Decisions: [rename cities → maps: yes/no]. [anything else from section 9].
>
> Start by checking that the hosts in section 3 are reachable (curl
> `https://overpass-api.de/api/status`). If they aren't, do Phase 0, say
> which host is blocked, and stop.
>
> Don't invent dates or data to fill gaps. Use `coverage.from` and leave
> things undated. Run typecheck, tests, `check-data` and the build before
> every push. Open a draft PR when Phase 0 is green, and push Phase 1 to the
> same PR.
