import { getJson, type Plugin, type Point } from "../renderer";
import type { Landmark } from "../schema";

export interface LandmarkOptions { url: string; color?: string; labelZoom?: number }

export function landmarks({ url, color = "#b03a2e", labelZoom = 1.5 }: LandmarkOptions): Plugin {
  let items: Landmark[] = [];
  let pos: Point[] = [];

  return {
    id: "landmarks",
    order: 20,

    async init(ctx) {
      items = (await getJson<Landmark[]>(url)) ?? [];
      items.forEach((it) => ctx.extendRange(it.start, it.end));
      ctx.addGroup({ id: "landmarks", label: "Landmarks", defaultOn: true });
    },

    onProject(ctx) {
      pos = items.map((it) => ctx.project(it.geo));
    },

    draw(ctx) {
      if (!ctx.isOn("landmarks")) return;
      const { g, state } = ctx;
      const stop = ctx.use("stop");   // typed via the network plugin's Services augmentation
      g.font = `${ctx.px(11)}px system-ui, sans-serif`;

      for (const [i, it] of items.entries()) {
        const life = ctx.life(it.start, it.end);
        if (life.alpha <= 0) continue;
        // In schematic mode, follow an anchor station if given; otherwise fade out with the base map.
        const a = it.anchor ? stop?.(it.anchor) : undefined;
        const [x, y] = a ? ctx.lerp(pos[i], [a[0] + ctx.px(10), a[1] - ctx.px(10)]) : pos[i];
        const vis = a ? 1 : 1 - state.morph;
        if (vis <= 0.01) continue;

        if (life.grow < 1) {   // ripple while it's being "built"
          g.globalAlpha = life.alpha * vis * (1 - life.grow);
          g.strokeStyle = color;
          g.lineWidth = ctx.px(1.5);
          g.beginPath();
          g.arc(x, y, ctx.px(4 + 18 * life.grow), 0, 2 * Math.PI);
          g.stroke();
        }

        g.globalAlpha = life.alpha * vis;
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(x, y - ctx.px(6));
        g.lineTo(x + ctx.px(5), y + ctx.px(4));
        g.lineTo(x - ctx.px(5), y + ctx.px(4));
        g.closePath();
        g.fill();
        if (state.t.k >= labelZoom) g.fillText(it.name, x + ctx.px(7), y + ctx.px(4));
      }
    },
  };
}
