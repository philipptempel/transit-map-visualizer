// Dates come from several sources of varying trust. Each source's value is parsed strictly
// (anything vague is dropped, never guessed), then the most trusted source wins per field.

export type DateSource = "override" | "ohm" | "wikidata" | "osm";

/** Highest precedence first. */
export const PRECEDENCE: DateSource[] = ["override", "ohm", "wikidata", "osm"];

export interface Evidence {
  field: "start" | "end";
  value: string;            // already parsed: "YYYY", "YYYY-MM" or "YYYY-MM-DD"
  source: DateSource;
  ref?: string;             // e.g. "Q123", "n456", or an override's source URL
}

export interface Dated { start?: string; end?: string; src?: string }

const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function valid(y: number, m?: number, d?: number): boolean {
  if (m != null && (m < 1 || m > 12)) return false;
  return d == null || (d >= 1 && d <= DAYS[m! - 1]);
}

/**
 * An OSM start_date / end_date, if it is a plain date. "~1985", "1980s", "before 1900",
 * "1985..1987" and the like are vague and return null.
 */
export function parseOsmDate(s: string | undefined): string | null {
  const m = s?.trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!m) return null;
  const [y, mo, d] = [m[1], m[2], m[3]].map((x) => (x == null ? undefined : Number(x)));
  return valid(y!, mo, d) ? m[0] : null;
}

/**
 * A Wikidata time value ("+1985-06-01T00:00:00Z") at its stated precision: 9 = year,
 * 10 = month, 11 = day. Anything coarser (decade, century) or BCE returns null.
 */
export function parseWikidataTime(time: string, precision: number): string | null {
  const m = time.match(/^\+(\d{4})-(\d{2})-(\d{2})T/);
  if (!m || precision < 9) return null;
  const [y, mo, d] = [m[1], m[2], m[3]];
  if (precision === 9) return y;
  if (!valid(Number(y), Number(mo))) return null;
  if (precision === 10) return `${y}-${mo}`;
  return valid(Number(y), Number(mo), Number(d)) ? `${y}-${mo}-${d}` : null;
}

const rank = (s: DateSource) => PRECEDENCE.indexOf(s);
const label = (e: Evidence) => (e.ref ? `${e.source}:${e.ref}` : e.source);

/**
 * Picks the most trusted start and end. If they contradict (start after end), the one from the
 * less trusted source is dropped; at equal trust the end goes. `src` names where each came from.
 */
export function mergeDates(evidence: Evidence[]): Dated {
  const best = (field: Evidence["field"]): Evidence | undefined =>
    evidence.filter((e) => e.field === field).sort((a, b) => rank(a.source) - rank(b.source))[0];
  let start = best("start"), end = best("end");
  // Same-length prefixes compare correctly as strings: "1985" vs "1985-06" compares the year part.
  if (start && end && start.value.slice(0, end.value.length) > end.value.slice(0, start.value.length)) {
    if (rank(start.source) > rank(end.source)) start = undefined;
    else end = undefined;
  }
  const out: Dated = {};
  if (start) out.start = start.value;
  if (end) out.end = end.value;
  const srcs = [...new Set([start, end].filter((e) => e).map((e) => label(e!)))];
  if (srcs.length) out.src = srcs.join(", ");
  return out;
}
