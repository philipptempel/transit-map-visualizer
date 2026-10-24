// One map page per city, at map/<id>.html, rendered from map.html.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { isAvailable } from "../src/catalog.ts";
import type { CityEntry } from "../src/schema.ts";

const CATALOG = "data/cities.json";   // inside Vite's public directory
const CITY_PATH = /^\/map\/([^/?#]+)\.html(?:[?#]|$)/;

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The city id in a /map/<id>.html URL, or undefined if there is none or it is malformed. */
function cityId(url: string | undefined): string | undefined {
  const raw = url?.match(CITY_PATH)?.[1];
  try {
    return raw && decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

function cities(publicDir: string): CityEntry[] {
  return (JSON.parse(readFileSync(join(publicDir, CATALOG), "utf8")) as CityEntry[]).filter(isAvailable);
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
  // Absolute, from Vite's resolved config, so builds started outside the project root work too.
  let publicDir = "";
  return {
    name: "city-pages",
    enforce: "post",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    // Dev server: serve map.html for /map/<id>.html, and 404 unknown ids as a static host would.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !CITY_PATH.test(req.url)) return next();
        const id = cityId(req.url);
        if (!id || !cities(publicDir).some((c) => c.id === id)) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("No such map");
          return;
        }
        req.url = "/map.html";
        next();
      });
    },
    transformIndexHtml: {
      order: "post",
      handler(html, { originalUrl, server }) {
        if (!server || !originalUrl) return html;
        const id = cityId(originalUrl);
        const city = id && cities(publicDir).find((c) => c.id === id);
        return city ? cityPage(html, city) : html;
      },
    },
    // Build: one copy of the built map.html per city. The shell itself is not a page.
    generateBundle(_options, bundle) {
      const shell = bundle["map.html"];
      if (shell?.type !== "asset") return;
      for (const city of cities(publicDir)) {
        this.emitFile({ type: "asset", fileName: `map/${city.id}.html`, source: cityPage(String(shell.source), city) });
      }
      delete bundle["map.html"];
    },
  };
}
