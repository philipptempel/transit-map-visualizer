import "./style.css";
import { distinct, isAvailable, MAP_TYPE_LABELS, matches, sortEntries, type Filters, type SortDir, type SortKey } from "./catalog";
import type { CityEntry, MapType } from "./schema";

const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`);

const regionName = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (code: string) => regionName.of(code) ?? code;
const formatDate = (d?: string) =>
  d ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(`${d}T00:00:00`)) : "—";

type Option = [value: string, label: string];
const byLabel = (a: Option, b: Option) => a[1].localeCompare(b[1]);

/** Rebuild a <select>; with no options it is disabled and shows `hint` instead. */
function fill(sel: HTMLSelectElement, all: string, options: Option[], current: string, hint = all) {
  sel.disabled = options.length === 0;
  sel.innerHTML = [[ "", options.length ? all : hint ] as Option, ...options]
    .map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`)
    .join("");
  sel.value = options.some(([v]) => v === current) ? current : "";
}

function card(c: CityEntry): string {
  const where = c.fictional
    ? "Fictional demo city"
    : [c.state, c.country && countryName(c.country), c.continent].filter(Boolean).join(" · ");
  const ready = isAvailable(c);
  const body = `
    <div class="flex items-start justify-between gap-3">
      <h3 class="text-lg font-semibold">${esc(c.name)}</h3>
      <span class="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">${MAP_TYPE_LABELS[c.type]}</span>
    </div>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">${esc(where)}</p>
    <dl class="mt-4 grid grid-cols-2 gap-2 text-xs">
      <div><dt class="text-neutral-500">Created</dt><dd class="font-medium tabular-nums">${formatDate(c.created)}</dd></div>
      <div><dt class="text-neutral-500">Updated</dt><dd class="font-medium tabular-nums">${formatDate(c.updated)}</dd></div>
    </dl>
    <p class="mt-auto pt-4 text-sm font-medium ${ready ? "text-emerald-700 group-hover:underline dark:text-emerald-400" : "text-neutral-500"}">
      ${ready ? "Open map &rarr;" : "Data not available yet"}
    </p>`;
  const box = "flex h-full flex-col rounded-xl border p-5 transition";
  return ready
    ? `<li><a href="map.html?city=${encodeURIComponent(c.id)}" class="group ${box} border-neutral-200 bg-white shadow-xs hover:border-emerald-600 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-emerald-500">${body}</a></li>`
    : `<li><div class="${box} border-dashed border-neutral-300 bg-neutral-50 opacity-75 dark:border-neutral-700 dark:bg-neutral-900/40" aria-disabled="true">${body}</div></li>`;
}

async function main() {
  const entries = (await (await fetch("data/cities.json")).json()) as CityEntry[];
  const form = $<HTMLFormElement>("#filters");
  const sortSel = $<HTMLSelectElement>("#sort");
  const typeSel = $<HTMLSelectElement>("#f-type");
  const contSel = $<HTMLSelectElement>("#f-continent");
  const ctrySel = $<HTMLSelectElement>("#f-country");
  const stateSel = $<HTMLSelectElement>("#f-state");
  const grid = $("#grid"), empty = $("#empty"), count = $("#count");

  let f: Filters = {};

  function render() {
    // Each geographic level only offers what exists inside the level above it.
    const inContinent = entries.filter((c) => f.continent && c.continent === f.continent);
    const inCountry = inContinent.filter((c) => f.country && c.country === f.country);
    fill(typeSel, "All types",
      distinct(entries, "type").map((t): Option => [t, MAP_TYPE_LABELS[t as MapType]]).sort(byLabel), f.type ?? "");
    fill(contSel, "All continents", distinct(entries, "continent").map((v): Option => [v, v]).sort(byLabel), f.continent ?? "");
    fill(ctrySel, "All countries", distinct(inContinent, "country").map((v): Option => [v, countryName(v)]).sort(byLabel),
      f.country ?? "", "Continent first");
    fill(stateSel, "All regions", distinct(inCountry, "state").map((v): Option => [v, v]).sort(byLabel),
      f.state ?? "", f.country ? "None for this country" : "Country first");

    const [key, dir] = sortSel.value.split(":") as [SortKey, SortDir];
    const shown = sortEntries(entries.filter((c) => matches(c, f)), key, dir);
    grid.innerHTML = shown.map(card).join("");
    empty.classList.toggle("hidden", shown.length > 0);
    const ready = shown.filter(isAvailable).length;
    count.textContent = `${shown.length} of ${entries.length} maps · ${ready} with data`;
  }

  form.addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value || undefined;
    // Changing a level clears the levels below it.
    if (e.target === typeSel) f = { ...f, type: v as MapType | undefined };
    if (e.target === contSel) f = { ...f, continent: v, country: undefined, state: undefined };
    if (e.target === ctrySel) f = { ...f, country: v, state: undefined };
    if (e.target === stateSel) f = { ...f, state: v };
    render();
  });
  form.addEventListener("reset", () => {
    f = {};
    setTimeout(render);   // let the browser reset the sort menu first
  });
  render();
}

main().catch((err) => console.error(err));
