import { describe, expect, it } from "vitest";
import type { LonLat } from "../../src/schema";
import { round, simplify, tidy } from "./simplify";

describe("simplify", () => {
  it("drops points closer to the line than the tolerance and keeps the rest", () => {
    // 0.00001° of latitude is about 1.1 m; 0.001° about 111 m.
    const pts: LonLat[] = [[0, 0], [0.001, 0.00001], [0.002, 0], [0.003, 0.001], [0.004, 0]];
    expect(simplify(pts, 5)).toEqual([[0, 0], [0.002, 0], [0.003, 0.001], [0.004, 0]]);
  });

  it("always keeps both ends", () => {
    expect(simplify([[0, 0], [1e-7, 0], [2e-7, 0]], 1000)).toEqual([[0, 0], [2e-7, 0]]);
  });
});

describe("tidy", () => {
  it("rounds and removes the duplicates rounding makes", () => {
    expect(tidy([[0.000001, 0], [0.000002, 0], [0.01, 0]], 0, 5)).toEqual([[0, 0], [0.01, 0]]);
    expect(round(-0.000001, 5)).toBe(0);
    expect(Object.is(round(-0.000001, 5), -0)).toBe(false);
  });
});
