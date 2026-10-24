import { describe, expect, it } from "vitest";
import { mergeDates, parseOsmDate, parseWikidataTime } from "./dates";

describe("parseOsmDate", () => {
  it("accepts plain dates", () => {
    expect(parseOsmDate("1985")).toBe("1985");
    expect(parseOsmDate(" 1985-06 ")).toBe("1985-06");
    expect(parseOsmDate("1985-06-01")).toBe("1985-06-01");
  });

  it("drops anything vague or malformed rather than guessing", () => {
    for (const s of ["~1985", "1980s", "before 1900", "1985..1987", "c. 1900", "1985-13", "1985-02-30", "85", "", undefined]) {
      expect(parseOsmDate(s)).toBeNull();
    }
  });
});

describe("parseWikidataTime", () => {
  it("keeps only what the precision vouches for", () => {
    expect(parseWikidataTime("+1985-06-01T00:00:00Z", 11)).toBe("1985-06-01");
    expect(parseWikidataTime("+1985-06-01T00:00:00Z", 10)).toBe("1985-06");
    expect(parseWikidataTime("+1985-00-00T00:00:00Z", 9)).toBe("1985");
    expect(parseWikidataTime("+1980-00-00T00:00:00Z", 8)).toBeNull();    // decade
    expect(parseWikidataTime("-0044-03-15T00:00:00Z", 11)).toBeNull();   // BCE
  });
});

describe("mergeDates", () => {
  it("lets the most trusted source win, per field", () => {
    expect(mergeDates([
      { field: "start", value: "1990", source: "osm", ref: "w1" },
      { field: "start", value: "1989-05", source: "wikidata", ref: "Q42" },
      { field: "end", value: "2001", source: "osm", ref: "w1" },
    ])).toEqual({ start: "1989-05", end: "2001", src: "wikidata:Q42, osm:w1" });
    expect(mergeDates([
      { field: "start", value: "1989", source: "wikidata", ref: "Q42" },
      { field: "start", value: "1988", source: "override", ref: "https://example.org/source" },
    ])).toEqual({ start: "1988", src: "override:https://example.org/source" });
  });

  it("drops the less trusted date when start and end contradict", () => {
    expect(mergeDates([
      { field: "start", value: "1995", source: "osm" },
      { field: "end", value: "1990", source: "ohm" },
    ])).toEqual({ end: "1990", src: "ohm" });
    expect(mergeDates([
      { field: "start", value: "1985-06", source: "osm" },
      { field: "end", value: "1985", source: "osm" },
    ])).toEqual({ start: "1985-06", end: "1985", src: "osm" });   // same year: no contradiction
  });

  it("returns nothing without evidence", () => {
    expect(mergeDates([])).toEqual({});
  });
});
