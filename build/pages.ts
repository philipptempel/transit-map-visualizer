// One page per map, at map/<id>.html, rendered from map.html.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { isAvailable } from "../src/catalog.ts";
import type { MapEntry } from "../src/schema.ts";

const CATALOG = "data/maps.json";   // inside Vite's public directory
const MAP_PATH = /^\/map\/([^/?#]+)\.html(?:[?#]|$)/;

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The map id in a /map/<id>.html URL, or undefined if there is none or it is malformed. */
function mapId(url: string | undefined): string | undefined {
  const raw = url?.match(MAP_PATH)?.[1];
  try {
    return raw && decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

function maps(publicDir: string): MapEntry[] {
  return (JSON.parse(readFileSync(join(publicDir, CATALOG), "utf8")) as MapEntry[]).filter(isAvailable);
}

/**
 * Turns the map.html shell into the page for one map. The page lives one level down,
 * so <base> points back at the site root and every relative URL resolves as before.
 */
function mapPage(html: string, map: MapEntry): string {
  const title = escape(`${map.name} · Transit evolution`);
  const description = escape(`${map.name}: an animated map of its transit network, year by year.`);
  return html
    .replace(/<meta charset="utf-8" \/>/, (m) => `${m}\n    <base href="../" />`)
    .replace(/<title>.*<\/title>/, [
      `<title>${title}</title>`,
      `<meta name="description" content="${description}" />`,
      `<meta property="og:title" content="${title}" />`,
      `<meta property="og:description" content="${description}" />`,
    ].join("\n    "));
}

export function mapPages(): Plugin {
  // Absolute, from Vite's resolved config, so builds started outside the project root work too.
  let publicDir = "";
  return {
    name: "map-pages",
    enforce: "post",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    // Dev server: serve map.html for /map/<id>.html, and 404 unknown ids as a static host would.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !MAP_PATH.test(req.url)) return next();
        const id = mapId(req.url);
        if (!id || !maps(publicDir).some((c) => c.id === id)) {
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
        const id = mapId(originalUrl);
        const map = id && maps(publicDir).find((c) => c.id === id);
        return map ? mapPage(html, map) : html;
      },
    },
    // Build: one copy of the built map.html per map. The shell itself is not a page.
    generateBundle(_options, bundle) {
      const shell = bundle["map.html"];
      if (shell?.type !== "asset") return;
      for (const map of maps(publicDir)) {
        this.emitFile({ type: "asset", fileName: `map/${map.id}.html`, source: mapPage(String(shell.source), map) });
      }
      delete bundle["map.html"];
    },
  };
}
