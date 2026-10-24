# Transit evolution

An animated map of how a city's public transport network grew, shrank and
changed over the years. Press play and watch tram lines get built, extended
and torn up, decade by decade.

The map can morph between a **geographic** view (lines as they run on the
ground, over a base map) and a **schematic** view (a tidied-up diagram in the
style of a metro map). Mode groups such as tram, S-Bahn or ferry can be
switched on and off individually.

A landing page explains the project and lists every map in a grid that can
be sorted by name or date and filtered by type of network and by continent,
country and state.

Only a fictional demo city, *Demostadt*, ships with data so far. The
configuration and route classification for real maps (Nantes, Stuttgart,
Den Haag, Rotterdam, and French national rail) are in place, and so is the
skeleton of the fetch script that will build their data (see
[Fetching data](#fetching-data)); its download stages are not written yet.
The landing page lists those maps as "data not available yet".

## Getting started

### With mise (recommended on macOS)

[mise] installs the Node version the project uses (24, the same as CI) and
runs the project's tasks. It installs npm dependencies by itself whenever
`package-lock.json` changes.

```sh
brew install mise
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc   # then open a new terminal

mise trust         # once: allow this repo's mise.toml
mise install       # once: fetch Node 24
mise run dev       # dev server with hot reload
mise run build     # typecheck and build into dist/, as CI does
mise run preview   # build, then serve the production build
mise run typecheck # typecheck only
mise run test      # unit tests
mise run check-data # validate the data under public/data/
mise tasks         # list all tasks
```

Inside the project, mise also puts `node_modules/.bin` on your `PATH`, so
`vite`, `tsc` and `shadcn` work without `npx`. For personal settings, use a
`mise.local.toml`; it is ignored by git.

### With npm

Requires Node.js 20.19+ or 22.12+ (what Vite 8 needs).

```sh
npm install
npm run dev        # dev server with hot reload
npm run build      # typecheck and build into dist/
npm run preview    # serve the production build
npm run typecheck  # typecheck only
npm test           # unit tests (vitest)
npm run check-data # validate the data under public/data/
npm run fetch -- --help   # build map data; see "Fetching data"
```

Open the URL Vite prints to get the landing page. Each map has its own page
at `map/<id>.html`, for example `map/demostadt.html`.

## Using the map

On the landing page, pick a map from the grid. The filters cascade: the
country menu fills once a continent is picked, and the state menu once a
country is picked. Changing a level clears the ones below it. Undated maps
sort last whichever direction a date sort runs.

On the map page:

- **Play / Pause** runs through the years at about four years per second.
  **Fast forward** and **rewind** set the direction: the first press in the
  other direction reverses at normal speed, and each further press doubles
  it, up to 8×. The play button's arrow shows which way it will run. **−**
  and **+** beside the speed step it down to 0.25× or up to 8× without
  changing direction. The slider jumps to a specific year.
- **Keyboard:** Space plays and pauses, `[` and `]` halve and double the
  speed (from 0.25× to 8×), and the left and right arrow keys step one year.
  `+` and `-` zoom in and out, and `0` resets the zoom.
- **Geographic / Schematic** morphs between the two layouts.
- **Checkboxes** in the header toggle mode groups and landmarks.
- **Scroll and drag** to zoom and pan, or use the zoom control in the top-right
  corner: its slider shows how far in you are, between 0.5× and 50×, and the
  number below resets the view. Zoomed out, only stops where something
  happens are shown: where a line ends, where lines merge, split or cross,
  and where two of the groups on show meet. The others fade in from 2×.
  Station names appear once you zoom in, the minor ones from 6×.
- **Notes** in the bottom-left corner of the map say which base map is shown
  and where a group's data does not reach back to the year on screen. The
  bottom-right corner credits the map's data sources.

## How it is built

The renderer draws onto a single `<canvas>` with [d3-geo], [d3-zoom] and
[d3-selection]. It knows almost nothing about transit itself. The actual
drawing happens in plugins, which run in order:

| Plugin      | Order | Draws                                                      |
| ----------- | ----- | ---------------------------------------------------------- |
| `basemap`   | 0     | Land, water, roads and so on, from the closest snapshot    |
| `network`   | 10    | Line segments, parallel lines side by side, and stations   |
| `landmarks` | 20    | Points of interest, which follow a station in schematic view |

Lines that share track are drawn side by side and chained from segment to
segment so each keeps its side. Lines that run together most of the way sit
next to each other (otherwise they go by `ref`: S1, S2, … S11), and each chain
is turned so that at its junctions the lines that branch off already sit on
the side they leave to. Where a line starts or ends at a stop, the others keep
their places at the stop and ease into their new ones along the next segment;
at a junction, a branch's lines start where they sat in the bundle. A stop is
drawn on its track, where its segments meet, rather than at the station
building OSM may place it at. Like a web map, lines are drawn with as much detail
as the zoom can show: each segment's geometry is simplified to half a pixel on
screen, coarse when zoomed out and fine when zoomed in, down to the detail the
data was built with. Zoomed
out, a group's bundles merge into one stroke (in the lines' shared colour, or
the group's) and fan out as the map zooms in; the more lines a group's widest
bundle holds, the further in it splits.

A plugin can implement `init` (load data, register toggle groups, widen the
year range), `onProject` (re-project after a resize) and `draw`. Plugins share
things through typed services; for example `network` provides `stop(id)` so
that `landmarks` can pin a landmark to a station as the map morphs. A plugin
that throws is logged and skipped rather than taking the whole map down.

The renderer and plugins are plain TypeScript and know nothing about the UI
around them. The pages are [React] with [shadcn/ui] components on
[Tailwind CSS] v4, and follow the system's light or dark setting. React only
mirrors the renderer's state in the controls; it never redraws the map.

shadcn/ui components are source files that live in the repo, in
`src/components/ui/`, and can be edited like any other code. To add another
one, run `npx shadcn@latest add <component>`; `components.json` holds the
settings it needs.

```text
index.html             landing page shell
map.html               map page shell, built into map/<id>.html per map
components.json        shadcn/ui settings
src/
  pages/               entry points that mount each page
  components/
    LandingPage.tsx    intro and how-to
    MapCatalog.tsx     the map grid with its sort and filter menus
    MapPage.tsx        map controls wired to the renderer
    ui/                shadcn/ui components (Vega preset, Radix)
  hooks/useCatalog.ts  loads data/maps.json
  catalog.ts           filtering and sorting of the map catalog
  renderer.ts          canvas, projection, zoom, timeline, plugin host
  schema.ts            data types shared by the renderer and the build step
  styles/globals.css   Tailwind and the shadcn/ui theme
  plugins/             basemap, network, landmarks
build/
  pages.ts             Vite plugin that renders the per-map pages
  fetch.ts             the fetch script: builds map data, scaffolds new maps
  check.ts             validator behind npm run check-data
  config.ts            MapConfig type, inclusion profiles and default mode groups
  maps/<id>.ts         one config per map
  classify.ts          maps OSM route tags or GTFS route types to modes
  area.ts, scaffold.ts --area lookup and the config template for fetch new
  stages/              network and basemap stages, run per map by fetch.ts
  sources/             cache, Overpass and Nominatim clients, OSM parsing
  graph/               stop dedupe, segment building, simplification, date merging
  out/                 writers for files and the catalog
  __fixtures__/        made-up source responses for the tests
public/data/           per-map data served as static JSON, under its own licence
```

## Data

Each map lives in `public/data/<map-id>/` and is listed in
`public/data/maps.json`, the catalog behind the landing page:

| Field       | Meaning                                                           |
| ----------- | ----------------------------------------------------------------- |
| `id`, `name`, `bbox` | Identifier, display name, and `[west, south, east, north]` |
| `type`      | `local`, `regional`, `national`, `continental` or `global`        |
| `network`   | `transit`, `rail`, `air` or `sea`                                 |
| `continent` | Continent name, such as `Europe`                                  |
| `country`   | ISO 3166-1 alpha-2 code; the page shows the English name          |
| `state`     | First-level region (state, province, région), if any              |
| `created`, `updated` | `YYYY-MM-DD` the map was added and its data last changed |
| `status`    | `planned` for maps with no data yet: listed, but not openable     |
| `fictional` | `true` for demo data; shown as "Fictional demo city"              |
| `attribution` | Credits for the data sources, shown on the map page             |
| `projection` | `mercator` (default) or `equalEarth`, for world maps             |

Location fields can be left out; such a map then only shows up while the
geographic filters are unset.

- **`network.json`**: mode groups, lines, stops and segments. A segment joins
  two stops and can carry its own geometry for both layouts (`geo`, `schem`)
  as well as `start` and `end` dates. It grows from `from` towards `to`, so
  for an extension put the stop that was there first in `from`. Lines on a
  segment can have their own dates too, so a route can be withdrawn while the
  track stays. Stops, segments and lines on a segment can say where their
  dates came from in `src`.
- **`network.detail.json`** (optional): finer geometry, one entry per segment
  in `network.json`'s order, `null` where there is nothing finer. The map
  draws with `network.json` first and swaps this in once it has loaded.
- **`landmarks.json`**: named points with optional dates and an optional
  `anchor` stop.
- **`basemap/index.json`**: a present-day base map and dated historical
  snapshots, each pointing at a GeoJSON file whose features have a `kind`
  (`land`, `green`, `water`, `waterway`, `road`, `rail`).

Dates can be `"YYYY"`, `"YYYY-MM"`, `"YYYY-MM-DD"` or a decimal year. A missing
date means open-ended. The full types are in [`src/schema.ts`](src/schema.ts).

## Fetching data

`npm run fetch` builds everything a map needs under `public/data/<id>/` from its
config in `build/maps/<id>.ts`, validates it, and updates its entry in
`maps.json`. Data is fetched locally, reviewed and committed; CI never fetches.

```sh
npm run fetch -- stuttgart                  # build one map
npm run fetch -- stuttgart nantes           # or several
npm run fetch -- --all
npm run fetch -- stuttgart --only network   # network | basemap | landmarks
npm run fetch -- stuttgart --offline        # answer from the cache only
npm run fetch -- stuttgart --refresh        # ignore the cache
npm run fetch -- stuttgart --dry-run        # report, write nothing
```

Every download is cached in `.cache/fetch/` (ignored by git), so a second run
with `--offline` rebuilds the same files without touching the network.
`OVERPASS_URL` points the script at another Overpass instance. One failed map
does not stop the others; the exit code is 0 when all went well, 1 when a map
failed and 2 for bad arguments.

The **network** stage queries Overpass for every route relation touching the
bbox, classifies it, merges stops (a shared stop_area, or the same name within
300 m), cuts each segment's geometry from the track, simplifies it and writes
`network.json`. Each stop gets one point on its track, where all its
segments end (rail decides over buses). `network.json` carries coarse
geometry (15 m for a city) for the overview and the first paint;
`network.detail.json` adds the fine geometry (1 m for rail, 5 m for buses).
It has no history yet: every group's `coverage.from` is the year of the OSM
snapshot, so the map opens on today's network and says so.
The **basemap** stage (cities and regions) takes water, parks and forest,
major roads and main-line rail from OSM, clips and simplifies them with
mapshaper, and writes `basemap/current.json`. Base maps for countries and
larger, and the **landmarks** stage, report "not implemented yet".

## Adding a map

1. Scaffold its config. The scope is `city`, `region`, `country`, `continent`
   or `world`; the network is `transit`, `rail`, `air` or `sea`:

   ```sh
   npm run fetch -- new karlsruhe --scope city    --network transit --area "Karlsruhe, DE"
   npm run fetch -- new de-rail   --scope country --network rail    --area DE
   npm run fetch -- new eu-rail   --scope continent --network rail  --area EU
   npm run fetch -- new klm       --scope world   --network air     --operator KLM
   ```

   `--area` takes a bbox (`w,s,e,n`), an ISO 3166 code (`DE`, `DE-BW`), a
   continent code (`AF AN AS EU NA OC SA`, with `--scope continent`) or a
   place name. **`EU` is Europe the continent, not the European Union.** The
   resolved bbox is written into the config, so later builds never repeat the
   lookup. `--dry-run` prints the config instead of writing it.
2. Check the config: bbox, catalog fields (continent, country, state), the
   inclusion profile (`local`, `local-plus-regional`, `national-rail`,
   `continental-rail`, `air`, `sea`) and, once data is in, `overrides` for
   routes the source data misclassifies, `exclude` for routes to leave out, and
   `lineColors` to give every line of a mode one colour. Heritage and tourist
   services (museum trams, steam trains) are left out of every map anyway,
   where OSM tags them as such.
3. Build it with `npm run fetch -- <id>`. A map whose data passes the checks
   becomes `available` in `maps.json`, and the build gives it a page at
   `map/<id>.html`.

`npm run check-data` validates every map with data: that stop and line ids
resolve, dates parse and no segment ends before it starts, coordinates lie
near the map's bbox, every segment's mode belongs to a group (otherwise it is
silently not drawn), and `network.json` stays within budget (1.5 MB for a
local or regional map, 5 MB for anything larger). The detail file must have
one entry per segment, each running from stop to stop, within four times that
budget. CI runs it before every build.

## Data sources

| Source | Used for | Licence |
| ------ | -------- | ------- |
| [OpenStreetMap] via Overpass | today's routes, stops, city base maps | ODbL |
| [OpenHistoricalMap] | closed and historical lines | ODbL |
| [Wikidata] | opening and closing dates of stations and lines | CC0 |
| [Natural Earth] | base maps for countries, continents, the world | public domain |
| [OurAirports] | airports | public domain |
| [OpenFlights] | a 2014 snapshot of airline routes | ODbL |
| `overrides/` (none yet) | hand-curated dates and routes, each with its source URL | facts; the map's licence |

Not all of these are wired up yet. Data derived from ODbL sources is itself
under the ODbL, separate from the GPL on the code; see
[`public/data/LICENSE.md`](public/data/LICENSE.md). Each map credits its
sources on its page. Dates are never invented to fill gaps: where the sources
stop, a group's `coverage.from` says so and the map shows a note.

## Deployment

The build uses relative URLs (`base: "./"` in `vite.config.ts`), so the same
`dist/` works at a domain root or under a project path.

- **GitHub Pages**: `.github/workflows/pages.yml` builds every push and pull
  request and deploys `master`. Enable it once under *Settings → Pages →
  Build and deployment → Source: GitHub Actions*.
- **GitLab Pages**: `.gitlab-ci.yml` does the same on GitLab, building merge
  requests and branches and publishing the default branch. No setup is
  needed beyond pushing.

## License

Copyright (C) 2026 Philipp Tempel

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option)
any later version. See [`LICENSE.md`](LICENSE.md) for the full text.

[mise]: https://mise.jdx.dev
[OpenStreetMap]: https://www.openstreetmap.org/copyright
[OpenHistoricalMap]: https://www.openhistoricalmap.org
[Wikidata]: https://www.wikidata.org
[Natural Earth]: https://www.naturalearthdata.com
[OurAirports]: https://ourairports.com/data/
[OpenFlights]: https://openflights.org/data
[React]: https://react.dev
[shadcn/ui]: https://ui.shadcn.com
[Tailwind CSS]: https://tailwindcss.com
[d3-geo]: https://d3js.org/d3-geo
[d3-zoom]: https://d3js.org/d3-zoom
[d3-selection]: https://d3js.org/d3-selection
