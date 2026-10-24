# Licence of the map data

The code of this project is under the GNU GPL (see `LICENSE.md` at the repository root).
The data in this directory is licensed separately.

## Data derived from OpenStreetMap and other ODbL sources

Map data built from OpenStreetMap, OpenHistoricalMap or OpenFlights is a derived database
of those sources. It is made available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Any rights in individual contents of the database are licensed under the
[Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/).

- © OpenStreetMap contributors, <https://www.openstreetmap.org/copyright>
- © OpenHistoricalMap contributors, <https://www.openhistoricalmap.org/copyright>
- OpenFlights, <https://openflights.org/data>

You may copy, distribute and adapt this data as long as you credit the sources above and
offer any database you derive from it under the ODbL as well.

Each map's entry in `maps.json` lists the credits that apply to it under `attribution`,
and the map page shows them.

## Public-domain and CC0 sources

Facts taken from Wikidata (CC0), Natural Earth, OurAirports and the NGA World Port Index
(all public domain) carry no licence conditions of their own. Where they are combined with
ODbL data in one file, the ODbL applies to that file.

## Hand-curated data

Files in `overrides/` at the repository root (none yet) record dates and routes from cited
sources, each with its source URL. They hold facts, not copied text. Where they are merged into a
map's data, that map's licence above applies.

## Demostadt

`demostadt/` is a fictional city, written by hand for this project. It is covered by the
project's GPL like the code.
