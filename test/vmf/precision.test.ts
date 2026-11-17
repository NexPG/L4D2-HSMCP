import { describe, expect, it } from "vitest";
import { mapVerticesPlus, stripVerticesPlus } from "../../src/vmf/precision.js";

const BLOCK = [
  "\t\t\tvertices_plus",
  "\t\t\t{",
  '\t\t\t\t"v" "0 0 0"',
  '\t\t\t\t"v" "64 0 0"',
  '\t\t\t\t"v" "64 64 0"',
  "\t\t\t}",
].join("\n");

describe("vertices_plus", () => {
  it("moves every stored vertex and leaves the block formatting alone", () => {
    const moved = mapVerticesPlus(BLOCK, (v) => [v[0] + 10, v[1] - 2, v[2] + 0.5]);
    expect(moved).toContain('"v" "10 -2 0.5"');
    expect(moved).toContain('"v" "74 -2 0.5"');
    expect(moved).toContain("\t\t\tvertices_plus");
    expect(moved).toContain("\t\t\t}");
  });

  it("removes the block when a face can no longer state the same loop", () => {
    const text = `side\n{\n${BLOCK}\n\t\t\t"plane" "(0 0 0) (1 0 0) (1 1 0)"\n}`;
    const stripped = stripVerticesPlus(text);
    expect(stripped).not.toContain("vertices_plus");
    expect(stripped).toContain('"plane"');
  });
});
