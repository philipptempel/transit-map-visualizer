import { createRenderer } from "./renderer";
import { basemap } from "./plugins/basemap";
import { landmarks } from "./plugins/landmarks";
import { network } from "./plugins/network";
import type { CityEntry } from "./schema";

const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

async function main() {
  const cities = (await (await fetch("data/cities.json")).json()) as CityEntry[];
  const wanted = new URLSearchParams(location.search).get("city");
  const city = cities.find((c) => c.id === wanted) ?? cities[0];

  const select = $<HTMLSelectElement>("#city");
  select.innerHTML = cities
    .map((c) => `<option value="${c.id}" ${c.id === city.id ? "selected" : ""}>${c.name}</option>`)
    .join("");
  select.onchange = () => { location.search = `?city=${select.value}`; };

  const base = `data/${city.id}`;
  const r = createRenderer({
    canvas: $<HTMLCanvasElement>("#map"),
    city,
    plugins: [
      basemap({ url: `${base}/basemap/index.json` }),
      network({ url: `${base}/network.json` }),
      landmarks({ url: `${base}/landmarks.json` }),
    ],
  });
  await r.ready;

  const groupsEl = $("#groups");
  groupsEl.innerHTML = r.groups()
    .map((gd) => `<label><input type="checkbox" data-g="${gd.id}" ${gd.on ? "checked" : ""}> ${gd.label}</label>`)
    .join(" ");
  groupsEl.addEventListener("change", (e) => {
    const box = e.target as HTMLInputElement;
    if (box.dataset.g) r.toggle(box.dataset.g, box.checked);
  });

  const slider = $<HTMLInputElement>("#slider");
  slider.oninput = () => r.setYear(Number(slider.value));
  $("#play").onclick = () => (r.state.playing ? r.pause() : r.play());

  const geoBtn = $("#geo"), schBtn = $("#sch");
  const setMode = (m: 0 | 1) => {
    r.setMode(m);
    geoBtn.setAttribute("aria-pressed", String(m === 0));
    schBtn.setAttribute("aria-pressed", String(m === 1));
  };
  geoBtn.onclick = () => setMode(0);
  schBtn.onclick = () => setMode(1);

  const yearEl = $("#year"), playEl = $("#play"), badgesEl = $("#badges");
  r.onChange(({ year, range, playing, badges }) => {
    slider.min = String(range[0]);
    slider.max = String(range[1]);
    if (document.activeElement !== slider) slider.value = String(Math.floor(year));
    yearEl.textContent = String(Math.floor(year));
    playEl.textContent = playing ? "Pause" : "Play";
    badgesEl.textContent = badges.join(" · ");
  });
}

main().catch((err) => console.error(err));
