import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isAvailable } from "@/catalog";
import { useCatalog } from "@/hooks/useCatalog";
import { basemap } from "@/plugins/basemap";
import { landmarks } from "@/plugins/landmarks";
import { network } from "@/plugins/network";
import { createRenderer, type Renderer, type Snapshot } from "@/renderer";
import type { CityEntry, ToggleGroup as Group } from "@/schema";

export function MapPage() {
  const entries = useCatalog();
  if (!entries) return null;
  const cities = entries.filter(isAvailable);
  const wanted = new URLSearchParams(location.search).get("city");
  const city = cities.find((c) => c.id === wanted) ?? cities[0];
  if (!city) return <p className="p-6 text-muted-foreground">No maps with data yet.</p>;
  return <MapView city={city} cities={cities} />;
}

function MapView({ city, cities }: { city: CityEntry; cities: CityEntry[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const [groups, setGroups] = useState<(Group & { on: boolean })[]>([]);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [layout, setLayout] = useState("geo");

  // The renderer draws on its own; React only mirrors its state in the controls.
  // It lives as long as the page, since picking another city reloads the page.
  useEffect(() => {
    if (renderer.current || !canvas.current) return;
    document.title = `${city.name} · Transit evolution`;
    const r = createRenderer({
      canvas: canvas.current,
      city,
      plugins: [
        basemap({ url: `data/${city.id}/basemap/index.json` }),
        network({ url: `data/${city.id}/network.json` }),
        landmarks({ url: `data/${city.id}/landmarks.json` }),
      ],
    });
    renderer.current = r;
    r.onChange(setSnap);
    r.ready.then(() => setGroups(r.groups())).catch((err) => console.error(err));
  }, [city]);

  const r = renderer.current;
  const year = Math.floor(snap?.year ?? 0);

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_auto] text-sm">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="outline" size="sm" asChild>
          <a href="./"><ArrowLeft data-icon="inline-start" /> All maps</a>
        </Button>
        <Select value={city.id} onValueChange={(id) => { location.search = `?city=${encodeURIComponent(id)}`; }}>
          <SelectTrigger size="sm" aria-label="Map"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
        <ToggleGroup
          type="single" variant="outline" size="sm" aria-label="Layout" value={layout}
          onValueChange={(v) => { if (!v) return; setLayout(v); r?.setMode(v === "sch" ? 1 : 0); }}
        >
          <ToggleGroupItem value="geo" className="px-3">Geographic</ToggleGroupItem>
          <ToggleGroupItem value="sch" className="px-3">Schematic</ToggleGroupItem>
        </ToggleGroup>
        <FieldSet id="groups" className="flex-row flex-wrap items-center gap-x-4 gap-y-1 px-1">
          <FieldLegend className="sr-only">Modes</FieldLegend>
          {groups.map((gd) => (
            <Field key={gd.id} orientation="horizontal" className="w-auto gap-2">
              <Checkbox
                id={`g-${gd.id}`} checked={gd.on}
                onCheckedChange={(v) => { r?.toggle(gd.id, v === true); setGroups(r?.groups() ?? []); }}
              />
              <FieldLabel htmlFor={`g-${gd.id}`} className="font-normal">{gd.label}</FieldLabel>
            </Field>
          ))}
        </FieldSet>
      </header>

      {/* The notes float over the map so the canvas keeps its size when they come and go. */}
      <div className="relative min-h-0">
        <canvas ref={canvas} id="map" className="absolute inset-0 block size-full touch-none bg-map" />
        {!!snap?.badges.length && (
          <ul id="badges" className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground shadow-xs backdrop-blur-sm">
            {snap.badges.map((b) => <li key={b}>{b}</li>)}
          </ul>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t px-3 py-2">
        <Button id="play" variant="outline" size="sm" className="w-24" disabled={!snap}
          onClick={() => (r?.state.playing ? r.pause() : r?.play())}>
          {snap?.playing ? <><Pause data-icon="inline-start" /> Pause</> : <><Play data-icon="inline-start" /> Play</>}
        </Button>
        <span id="year" className="min-w-[4ch] text-3xl font-semibold tabular-nums">{snap ? year : ""}</span>
        <Slider
          aria-label="Year" className="flex-1" step={1} disabled={!snap}
          min={snap?.range[0] ?? 0} max={snap?.range[1] ?? 1} value={[year]}
          onValueChange={([y]) => {
            r?.setYear(y);
            // Update now rather than on the next frame, or fast key repeats work from a stale year.
            setSnap((s) => s && { ...s, year: y, playing: false });
          }}
        />
      </footer>
    </div>
  );
}
