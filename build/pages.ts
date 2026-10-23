// One map page per city, at map/<id>.html, rendered from map.html.

import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { isAvailable } from "../src/catalog";
import type { CityEntry } from "../src/schema";

const CATALOG = "public/data/cities.json";
const CITY_PATH = /^\/map\/([^/?#]+)\.html(?:[?#]|$)/;

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function cities(): CityEntry[] {
  return (JSON.parse(readFileSync(CATALOG, "utf8")) as CityEntry[]).filter(isAvailable);
}

/**
 * Turns the map.html shell into the page for one city. The page lives one level down,
 * so <base> points back at the site root and every relative URL resolves as before.
 */
function cityPage(html: string, city: CityEntry): string {
  const title = escape(`${city.name} · Transit evolution`);
  const description = escape(`${city.name}: an animated map of its transit network, year by year.`);
  return html
    .replace(/<meta charset="utf-8" \/>/, (m) => `${m}\n    <base href="../" />`)
    .replace(/<title>.*<\/title>/, [
      `<title>${title}</title>`,
      `<meta name="description" content="${description}" />`,
      `<meta property="og:title" content="${title}" />`,
      `<meta property="og:description" content="${description}" />`,
    ].join("\n    "));
}

export function cityPages(): Plugin {
  return {
    name: "city-pages",
    enforce: "post",
    // Dev server: serve map.html for /map/<id>.html.
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && CITY_PATH.test(req.url)) req.url = "/map.html";
        next();
      });
    },
    transformIndexHtml: {
      order: "post",
      handler(html, { originalUrl, server }) {
        if (!server || !originalUrl) return html;
        const id = originalUrl.match(CITY_PATH)?.[1];
        const city = id && cities().find((c) => c.id === decodeURIComponent(id));
        return city ? cityPage(html, city) : html;
      },
    },
    // Build: one copy of the built map.html per city. The shell itself is not a page.
    generateBundle(_options, bundle) {
      const shell = bundle["map.html"];
      if (shell?.type !== "asset") return;
      for (const city of cities()) {
        this.emitFile({ type: "asset", fileName: `map/${city.id}.html`, source: cityPage(String(shell.source), city) });
      }
      delete bundle["map.html"];
    },
  };
}
