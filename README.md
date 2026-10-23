# Transit evolution

An animated map of how a city's public transport network grew, shrank and
changed over the years. Press play and watch tram lines get built, extended
and torn up, decade by decade.

The map can morph between a **geographic** view (lines as they run on the
ground, over a base map) and a **schematic** view (a tidied-up diagram in the
style of a metro map). Mode groups such as tram, S-Bahn or ferry can be
switched on and off individually.

Only a fictional demo city, *Demostadt*, ships with data so far. The
configuration and route classification for real cities (Nantes, Stuttgart,
Den Haag, Rotterdam, and French national rail) are in place, but the step
that fetches their data is not written yet.

## Getting started

Requires Node.js 20 or newer.

```sh
npm install
npm run dev        # dev server with hot reload
npm run build      # typecheck and build into dist/
npm run preview    # serve the production build
npm run typecheck  # typecheck only
```

Open the URL Vite prints. Pick a city with `?city=<id>`, for example
`?city=demostadt`.

## Using the map

- **Play / Pause** runs through the years at about four years per second.
  The slider jumps to a specific year.
- **Geographic / Schematic** morphs between the two layouts.
- **Checkboxes** in the header toggle mode groups and landmarks.
- **Scroll and drag** to zoom and pan. Station names appear once you zoom in.
- **Badges** in the footer say which base map is shown and where a group's
  data does not reach back to the year on screen.

## How it is built

The renderer draws onto a single `<canvas>` with [d3-geo], [d3-zoom] and
[d3-selection]. It knows almost nothing about transit itself. The actual
drawing happens in plugins, which run in order:

| Plugin      | Order | Draws                                                      |
| ----------- | ----- | ---------------------------------------------------------- |
| `basemap`   | 0     | Land, water, roads and so on, from the closest snapshot    |
| `network`   | 10    | Line segments, parallel lines side by side, and stations   |
| `landmarks` | 20    | Points of interest, which follow a station in schematic view |

A plugin can implement `init` (load data, register toggle groups, widen the
year range), `onProject` (re-project after a resize) and `draw`. Plugins share
things through typed services; for example `network` provides `stop(id)` so
that `landmarks` can pin a landmark to a station as the map morphs. A plugin
that throws is logged and skipped rather than taking the whole map down.

```text
index.html             page shell and controls
src/
  main.ts              wires the controls to the renderer
  renderer.ts          canvas, projection, zoom, timeline, plugin host
  schema.ts            data types shared by the renderer and the build step
  plugins/             basemap, network, landmarks
build/
  config.ts            cities, inclusion profiles and default mode groups
  classify.ts          maps OSM route tags or GTFS route types to modes
public/data/           per-city data served as static JSON
```

## Data

Each city lives in `public/data/<city-id>/` and is listed in
`public/data/cities.json` with an id, name and bounding box.

- **`network.json`**: mode groups, lines, stops and segments. A segment joins
  two stops and can carry its own geometry for both layouts (`geo`, `schem`)
  as well as `start` and `end` dates. Lines on a segment can have their own
  dates too, so a route can be withdrawn while the track stays.
- **`landmarks.json`**: named points with optional dates and an optional
  `anchor` stop.
- **`basemap/index.json`**: a present-day base map and dated historical
  snapshots, each pointing at a GeoJSON file whose features have a `kind`
  (`land`, `green`, `water`, `waterway`, `road`, `rail`).

Dates can be `"YYYY"`, `"YYYY-MM"`, `"YYYY-MM-DD"` or a decimal year. A missing
date means open-ended. The full types are in [`src/schema.ts`](src/schema.ts).

## Adding a city

1. Add an entry to `CITIES` in [`build/config.ts`](build/config.ts): bounding
   box, an inclusion profile (`local`, `local-plus-regional` or
   `national-rail`) and any overrides for routes the source data
   misclassifies. The match rules there are starting guesses and need
   checking against the real feeds.
2. Produce `network.json` and friends for it under `public/data/<city-id>/`,
   using `classify()` from [`build/classify.ts`](build/classify.ts) to assign
   modes.
3. Add the city to `public/data/cities.json`.

## License

Copyright (C) 2026 Philipp Tempel

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License version 3. See
[`LICENSE.md`](LICENSE.md) for the full text.

[d3-geo]: https://d3js.org/d3-geo
[d3-zoom]: https://d3js.org/d3-zoom
[d3-selection]: https://d3js.org/d3-selection
