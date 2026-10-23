import { type MouseEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, FastForward, Pause, Play, Rewind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isAvailable } from "@/catalog";
import { cn } from "@/lib/utils";
import { useCatalog } from "@/hooks/useCatalog";
import { basemap } from "@/plugins/basemap";
import { landmarks } from "@/plugins/landmarks";
import { network } from "@/plugins/network";
import { createRenderer, type Renderer, type Snapshot } from "@/renderer";
import type { CityEntry, ToggleGroup as Group } from "@/schema";

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

/** Moves `by` steps along SPEEDS, faster when positive, keeping the direction. */
function nudge(speed: number, by: number) {
  const i = Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(Math.abs(speed)) + by));
  return Math.sign(speed) * SPEEDS[i];
}

/** Whether the focused element handles `key` itself: typing, pressing a button, or moving in a slider, menu or radio group. */
function ownsKey(target: EventTarget | null, key: string) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable], [role=listbox], [role=menu]")) return true;
  if (key === " ") return !!target.closest("button, a, [role=checkbox], [role=radio], [role=switch], [role=combobox]");
  if (key.startsWith("Arrow")) return !!target.closest("[role=slider], [role=radio], [role=combobox]");
  return false;
}

// A click leaves focus where it was, so Space keeps meaning play / pause afterwards.
const keepFocus = { onMouseDown: (e: MouseEvent) => e.preventDefault() };

export function MapPage() {
  const entries = useCatalog();
  if (!entries) return null;
  const cities = entries.filter(isAvailable);
  const wanted = decodeURIComponent(location.pathname.match(/\/map\/([^/]+)\.html$/)?.[1] ?? "");
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
  const reversed = !!snap && snap.speed < 0;

  // Playback actions, shared by the buttons and the keyboard. They read the renderer's live state.
  const seek = (y: number) => {
    if (!r) return;
    const landed = r.setYear(y);
    // Update now rather than on the next frame, or fast key repeats work from a stale year.
    setSnap((s) => s && { ...s, year: landed, playing: false });
  };
  const step = (dir: 1 | -1) => {
    if (r) seek(dir > 0 ? Math.floor(r.state.year) + 1 : Math.ceil(r.state.year) - 1);
  };
  const playAt = (speed: number) => { r?.setSpeed(speed); r?.play(); };
  const playPause = () => (r?.state.playing ? r.pause() : r?.play());
  /** Speeds up in `dir`. Coming from the other direction, the first press reverses at 1×. */
  const faster = (dir: 1 | -1) => {
    if (r) playAt(Math.sign(r.state.speed) === dir ? nudge(r.state.speed, 1) : dir);
  };
  const changeSpeed = (by: 1 | -1) => r?.setSpeed(nudge(r.state.speed, by));

  const loaded = snap !== null;
  useEffect(() => {
    if (!loaded) return;
    const keys: Record<string, () => void> = {
      " ": playPause,
      "[": () => changeSpeed(-1),
      "]": () => changeSpeed(1),
      ArrowLeft: () => step(-1),
      ArrowRight: () => step(1),
    };
    const onKey = (e: KeyboardEvent) => {
      // Alt is allowed: some layouts, such as German on a Mac, type [ and ] with it.
      const act = keys[e.key];
      if (!act || e.ctrlKey || e.metaKey || e.defaultPrevented || ownsKey(e.target, e.key)) return;
      e.preventDefault();
      if (!(e.repeat && e.key === " ")) act();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // The renderer never changes once it exists, so the actions from this render stay valid.
  }, [loaded]);

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_auto] text-sm">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="outline" size="sm" asChild>
          <a href="./"><ArrowLeft data-icon="inline-start" /> All maps</a>
        </Button>
        <Select value={city.id} onValueChange={(id) => { location.href = `map/${encodeURIComponent(id)}.html`; }}>
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
        <ButtonGroup aria-label="Playback">
          <Button variant="outline" size="icon-sm" disabled={!snap} aria-label="Faster backwards" title="Faster backwards"
            onClick={() => faster(-1)} {...keepFocus}>
            <Rewind />
          </Button>
          <Button id="play" variant="outline" size="sm" className="w-24" disabled={!snap}
            aria-label={!snap?.playing && reversed ? "Play backwards" : undefined}
            title={snap?.playing ? "Pause (Space)" : reversed ? "Play backwards (Space)" : "Play (Space)"}
            onClick={playPause} {...keepFocus}>
            {snap?.playing
              ? <><Pause data-icon="inline-start" /> Pause</>
              : <><Play data-icon="inline-start" className={cn(reversed && "rotate-180")} /> Play</>}
          </Button>
          <Button variant="outline" size="icon-sm" disabled={!snap} aria-label="Faster forward" title="Faster forward"
            onClick={() => faster(1)} {...keepFocus}>
            <FastForward />
          </Button>
          <ButtonGroupText id="speed" className="w-16 justify-center tabular-nums" title="Speed: [ slower, ] faster">
            {snap ? `${snap.speed < 0 ? "−" : ""}${Math.abs(snap.speed)}×` : ""}
          </ButtonGroupText>
        </ButtonGroup>
        <span id="year" className="min-w-[4ch] text-3xl font-semibold tabular-nums">{snap ? year : ""}</span>
        <Slider
          aria-label="Year" className="flex-1" step={1} disabled={!snap}
          min={snap?.range[0] ?? 0} max={snap?.range[1] ?? 1} value={[year]}
          onValueChange={([y]) => seek(y)}
        />
      </footer>
    </div>
  );
}
