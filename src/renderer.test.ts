import { describe, expect, it } from "vitest";
import { along, cutAt, simplify, type Point } from "./renderer";

describe("simplify", () => {
  const wiggle: Point[] = [[0, 0], [10, 0.2], [20, 0], [30, 3], [40, 0]];

  it("drops what would move the line by less than the tolerance, and keeps the rest", () => {
    expect(simplify(wiggle, 0.5)).toEqual([[0, 0], [20, 0], [30, 3], [40, 0]]);
    expect(simplify(wiggle, 5)).toEqual([[0, 0], [40, 0]]);
  });

  it("keeps a hook that reaches past the ends", () => {
    expect(simplify([[0, 0], [10, 0], [-5, 0], [5, 0]], 1)).toHaveLength(4);
  });

  it("gets finer as the tolerance halves, the way zooming in does", () => {
    const curve: Point[] = Array.from({ length: 50 }, (_, i) => [i, Math.sin(i / 8) * 10]);
    const counts = [4, 2, 1, 0.5, 0.25, 0.125].map((tol) => simplify(curve, tol).length);
    expect(counts.every((n, i) => i === 0 || n >= counts[i - 1])).toBe(true);
    expect(counts[0]).toBeLessThan(counts.at(-1)!);
  });
});

describe("cutAt", () => {
  // A long first leg and a short second one: index and length disagree.
  const pts: Point[] = [[0, 0], [90, 0], [100, 0]];

  it("cuts by length, not by point index", () => {
    expect(cutAt(pts, 0.5)).toEqual([[0, 0], [50, 0]]);
    expect(cutAt(pts, 0.95)).toEqual([[0, 0], [90, 0], [95, 0]]);
    expect(cutAt(pts, 1)).toBe(pts);
  });

  it("measures how far along each point lies", () => {
    expect(along(pts)).toEqual([0, 0.9, 1]);
  });
});
