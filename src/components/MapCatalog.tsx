import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { distinct, isAvailable, MAP_TYPE_LABELS, matches, sortEntries, type Filters, type SortDir, type SortKey } from "@/catalog";
import { cn } from "@/lib/utils";
import type { CityEntry, MapType } from "@/schema";

type Option = [value: string, label: string];

const ALL = "__all";   // Radix Select items cannot have an empty value
const SORTS: Option[] = [
  ["name:asc", "Name: A to Z"],
  ["name:desc", "Name: Z to A"],
  ["created:desc", "Created: newest"],
  ["created:asc", "Created: oldest"],
  ["updated:desc", "Updated: newest"],
  ["updated:asc", "Updated: oldest"],
];

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (code: string) => regionNames.of(code) ?? code;
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const formatDate = (d?: string) => (d ? dateFormat.format(new Date(`${d}T00:00:00`)) : "—");
const byLabel = (a: Option, b: Option) => a[1].localeCompare(b[1]);

interface FilterSelectProps {
  id: string; label: string; allLabel: string; hint?: string;
  value?: string; options: Option[]; onChange: (v: string | undefined) => void;
}

/** With no options the menu is disabled and shows `hint`. */
function FilterSelect({ id, label, allLabel, hint = allLabel, value, options, onChange }: FilterSelectProps) {
  const disabled = options.length === 0;
  return (
    <Field className="gap-1.5" data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id} className="text-xs text-muted-foreground">{label}</FieldLabel>
      <Select
        disabled={disabled}
        value={disabled ? "" : (value ?? ALL)}
        onValueChange={(v) => onChange(v === ALL ? undefined : v)}
      >
        <SelectTrigger id={id}><SelectValue placeholder={hint} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function MapCard({ entry: c }: { entry: CityEntry }) {
  const ready = isAvailable(c);
  const where = c.fictional
    ? "Fictional demo city"
    : [c.state, c.country && countryName(c.country), c.continent].filter(Boolean).join(" · ");
  const card = (
    <Card className={cn("h-full gap-4 transition",
      ready ? "group-hover:border-emerald-600/60 group-hover:shadow-md" : "border-dashed bg-muted/40 opacity-75 shadow-none")}>
      <CardHeader>
        <CardTitle className="text-lg">{c.name}</CardTitle>
        <CardDescription>{where}</CardDescription>
        <CardAction><Badge variant="secondary">{MAP_TYPE_LABELS[c.type]}</Badge></CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div><dt className="text-muted-foreground">Created</dt><dd className="font-medium tabular-nums">{formatDate(c.created)}</dd></div>
          <div><dt className="text-muted-foreground">Updated</dt><dd className="font-medium tabular-nums">{formatDate(c.updated)}</dd></div>
        </dl>
      </CardContent>
      <CardFooter className="mt-auto text-sm font-medium">
        {ready
          ? <span className="inline-flex items-center gap-1 text-emerald-700 group-hover:underline dark:text-emerald-400">Open map <ArrowRight className="size-4" /></span>
          : <span className="text-muted-foreground">Data not available yet</span>}
      </CardFooter>
    </Card>
  );
  return (
    <li>
      {ready
        ? <a href={`map.html?city=${encodeURIComponent(c.id)}`} className="group block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">{card}</a>
        : <div className="h-full" aria-disabled="true">{card}</div>}
    </li>
  );
}

export function MapCatalog({ entries }: { entries: CityEntry[] }) {
  const [sort, setSort] = useState("name:asc");
  const [f, setF] = useState<Filters>({});

  // Each geographic level only offers what exists inside the level above it.
  const menus = useMemo(() => {
    const inContinent = entries.filter((c) => f.continent && c.continent === f.continent);
    const inCountry = inContinent.filter((c) => f.country && c.country === f.country);
    return {
      types: distinct(entries, "type").map((t): Option => [t, MAP_TYPE_LABELS[t as MapType]]).sort(byLabel),
      continents: distinct(entries, "continent").map((v): Option => [v, v]).sort(byLabel),
      countries: distinct(inContinent, "country").map((v): Option => [v, countryName(v)]).sort(byLabel),
      states: distinct(inCountry, "state").map((v): Option => [v, v]).sort(byLabel),
    };
  }, [entries, f.continent, f.country]);

  const shown = useMemo(() => {
    const [key, dir] = sort.split(":") as [SortKey, SortDir];
    return sortEntries(entries.filter((c) => matches(c, f)), key, dir);
  }, [entries, f, sort]);

  return (
    <section className="mt-14" aria-labelledby="maps">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="maps" className="text-xl font-semibold">Maps</h2>
        <p id="count" className="text-sm text-muted-foreground" aria-live="polite">
          {shown.length} of {entries.length} maps · {shown.filter(isAvailable).length} with data
        </p>
      </div>

      <Card size="sm" className="mt-4">
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field className="gap-1.5">
            <FieldLabel htmlFor="sort" className="text-xs text-muted-foreground">Sort by</FieldLabel>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger id="sort"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORTS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <FilterSelect id="f-type" label="Type" allLabel="All types" options={menus.types}
            value={f.type} onChange={(v) => setF({ ...f, type: v as MapType | undefined })} />
          {/* Changing a level clears the levels below it. */}
          <FilterSelect id="f-continent" label="Continent" allLabel="All continents" options={menus.continents}
            value={f.continent} onChange={(v) => setF({ ...f, continent: v, country: undefined, state: undefined })} />
          <FilterSelect id="f-country" label="Country" allLabel="All countries" hint="Continent first" options={menus.countries}
            value={f.country} onChange={(v) => setF({ ...f, country: v, state: undefined })} />
          <FilterSelect id="f-state" label="State / region" allLabel="All regions"
            hint={f.country ? "None for this country" : "Country first"} options={menus.states}
            value={f.state} onChange={(v) => setF({ ...f, state: v })} />
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={() => { setF({}); setSort("name:asc"); }}>Reset</Button>
          </div>
        </CardContent>
      </Card>

      {shown.length > 0
        ? <ul id="grid" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shown.map((c) => <MapCard key={c.id} entry={c} />)}</ul>
        : <p id="empty" className="mt-6 rounded-xl border border-dashed p-8 text-center text-muted-foreground">No maps match these filters.</p>}
    </section>
  );
}
