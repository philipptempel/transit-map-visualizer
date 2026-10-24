import { describe, expect, it } from "vitest";
import type { Segment } from "../schema";
import { orient } from "./orient";

const seg = (from: string, to: string, lines: string[], mode: Segment["mode"] = "s_bahn"): Segment => ({ from, to, mode, lines });
const byMode = (s: Segment) => s.mode;

/** The stops in drawing order, to see that each segment starts where the last one ended. */
const drawn = (segs: Segment[], flip: boolean[]) => segs.map((s, i) => (flip[i] ? [s.to, s.from] : [s.from, s.to]));

describe("orient", () => {
  it("keeps one direction along a line whatever order the stop ids sort in", () => {
    // "n2" > "n10" < "n3" > "n11" as strings: comparing ids flipped every other segment.
    const segs = [seg("n2", "n10", ["S1", "S2"]), seg("n10", "n3", ["S1", "S2"]), seg("n3", "n11", ["S1", "S2"])];
    expect(drawn(segs, orient(segs, byMode))).toEqual([["n2", "n10"], ["n10", "n3"], ["n3", "n11"]]);
  });

  it("turns segments written against the flow of their neighbours", () => {
    const segs = [seg("a", "b", ["S1"]), seg("c", "b", ["S1"]), seg("c", "d", ["S1"]), seg("e", "d", ["S1"])];
    expect(drawn(segs, orient(segs, byMode))).toEqual([["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"]]);
  });

  it("follows the branch that shares the most lines through a junction", () => {
    const segs = [seg("a", "b", ["S1", "S2", "S3"]), seg("d", "b", ["S3"]), seg("c", "b", ["S1", "S2"])];
    const flip = orient(segs, byMode);
    expect(drawn(segs, flip)[0]).toEqual(["a", "b"]);
    expect(drawn(segs, flip)[2]).toEqual(["b", "c"]);
  });

  it("joins two segments at a stop even when they share no line", () => {
    const segs = [seg("a", "b", ["U1"]), seg("c", "b", ["U2"])];
    expect(drawn(segs, orient(segs, byMode))).toEqual([["a", "b"], ["b", "c"]]);
  });

  it("chains only segments of the same group", () => {
    const segs = [seg("a", "b", ["1"], "bus"), seg("c", "b", ["1"], "tram")];
    expect(orient(segs, byMode)).toEqual([false, false]);
    expect(orient(segs, () => undefined)).toEqual([false, false]);
  });

  it("survives a loop", () => {
    const segs = [seg("a", "b", ["R"]), seg("b", "c", ["R"]), seg("c", "a", ["R"])];
    expect(drawn(segs, orient(segs, byMode))).toEqual([["a", "b"], ["b", "c"], ["c", "a"]]);
  });
});
