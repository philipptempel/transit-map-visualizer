import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MapCatalog } from "@/components/MapCatalog";
import { useCatalog } from "@/hooks/useCatalog";

const STEPS = [
  ["1. Pick a map", "Choose one from the list below. Filter by region or type of network to narrow it down."],
  ["2. Press play", "The years roll forward and lines appear as they open. Drag the slider to jump to any year."],
  ["3. Switch layouts", "Geographic shows lines where they run. Schematic morphs them into a tidy metro-style diagram."],
  ["4. Explore", "Toggle modes such as tram or S-Bahn. Scroll to zoom, drag to pan. Station names appear up close."],
];

export function LandingPage() {
  const entries = useCatalog();
  return (
    <>
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="max-w-3xl">
          <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-400">Transit evolution</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-balance sm:text-5xl">Watch transit networks grow</h1>
          <p className="mt-5 text-lg text-pretty text-muted-foreground">
            Every tram line and metro tunnel was built at some point, and plenty were torn up again.
            These animated maps replay that history year by year, so you can see why a network looks the way it
            does today: which lines are old, which are new, and which ones quietly disappeared.
          </p>
        </section>

        <section className="mt-12" aria-labelledby="how">
          <h2 id="how" className="text-xl font-semibold">How to use it</h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([title, text]) => (
              <li key={title}>
                <Card className="h-full py-4">
                  <CardHeader className="px-4">
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{text}</CardDescription>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        {entries && <MapCatalog entries={entries} />}
      </main>

      <footer className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
        Free software under the GNU GPL v3 or later.{" "}
        <a className="underline hover:text-foreground" href="https://github.com/philipptempel/transit-map-visualizer">Source code</a>
      </footer>
    </>
  );
}
