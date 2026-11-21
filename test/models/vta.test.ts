/**
 * VTA: the flex target file, read and written.
 *
 * The format is small and the mistakes are silent: a basis that misses a vertex, a frame
 * that stores the delta instead of the deformed position, or a duplicate index. The tests
 * pin the shape, the round trip and the two warnings that catch a broken hand edit.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { parseVta } from "../../src/models/typescript/formats/vta.js";
import { readVtaTool, writeVtaTool } from "../../src/models/typescript/tools/vta.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-vta-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const basis = [
  { index: 0, position: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] },
  { index: 1, position: [10, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] },
  { index: 2, position: [0, 10, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] },
];

describe("VTA format", () => {
  it("reads a hand-written VTA with a named frame and a comment", () => {
    const text = [
      "version 1",
      "nodes",
      '0 "root" -1',
      '1 "jaw" 0',
      "end",
      "skeleton",
      "time 0 # basis shape key",
      "time 1 # open",
      "end",
      "vertexanimation",
      "time 0 # basis shape key",
      "    0 0.000000 0.000000 0.000000 0.000000 0.000000 1.000000",
      "    1 10.000000 0.000000 0.000000 0.000000 0.000000 1.000000",
      "time 1 # open",
      "    0 0.000000 0.000000 -5.000000 0.000000 0.000000 1.000000",
      "end",
      "",
    ].join("\n");
    const parsed = parseVta(text);
    expect(parsed.nodes).toEqual([
      { index: 0, name: "root", parent: -1 },
      { index: 1, name: "jaw", parent: 0 },
    ]);
    expect(parsed.skeletonFrames).toEqual([0, 1]);
    expect(parsed.basis.vertices).toHaveLength(2);
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.frames[0]).toMatchObject({ frame: 1, name: "open" });
    expect(parsed.frames[0]!.vertices[0]!.position[2]).toBe(-5);
    expect(parsed.warnings).toEqual([]);
  });

  it("warns about an empty basis and a duplicate index", () => {
    const empty = parseVta(
      ["version 1", "nodes", '0 "root" -1', "end", "skeleton", "time 0", "end", "vertexanimation", "end"].join(
        "\n",
      ),
    );
    expect(empty.warnings.join(" ")).toMatch(/basis .* has no vertices/);

    const duplicate = parseVta(
      [
        "version 1",
        "nodes",
        '0 "root" -1',
        "end",
        "skeleton",
        "time 0",
        "end",
        "vertexanimation",
        "time 0",
        "    0 0 0 0 0 0 1",
        "    0 1 1 1 0 0 1",
        "end",
      ].join("\n"),
    );
    expect(duplicate.warnings.join(" ")).toMatch(/appears more than once/);
  });
});

describe("write_vta and read_vta", () => {
  it("writes a basis and one flex, then reads the same data back", async () => {
    const path = join(scratch, "test.vta");
    const written = (await writeVtaTool.handler(
      {
        path,
        nodes: [{ name: "root", parent: -1 }],
        basis,
        frames: [
          {
            name: "smile",
            vertices: [{ index: 0, position: [0, 0, -2] as [number, number, number], normal: [0, 0, 1] as [number, number, number] }],
          },
        ],
        confirm: true,
      } as never,
      ctx,
    )) as { written: boolean; verified: boolean; basisVertices: number; frameCount: number };
    expect(written).toMatchObject({ written: true, verified: true, basisVertices: 3, frameCount: 1 });

    const text = readFileSync(path, "latin1");
    expect(text).toContain("time 1 # smile");
    expect(text).toContain('0 "root" -1');

    const read = (await readVtaTool.handler({ path } as never, ctx)) as {
      basisVertices: number;
      frames: Array<{ frame: number; name: string; vertices: number }>;
      warnings: string[];
    };
    expect(read.basisVertices).toBe(3);
    expect(read.frames).toEqual([{ frame: 1, name: "smile", vertices: 1 }]);
    expect(read.warnings).toEqual([]);

    const withData = (await readVtaTool.handler({ path, includeVertices: true } as never, ctx)) as {
      basis: Array<{ index: number }>;
      frames: Array<{ data: Array<{ index: number; position: number[] }> }>;
    };
    expect(withData.basis.map((vertex) => vertex.index)).toEqual([0, 1, 2]);
    expect(withData.frames[0]!.data[0]!.position[2]).toBe(-2);
  });

  it("writes a VTA with no nodes as a static prop", async () => {
    const path = join(scratch, "static.vta");
    const result = (await writeVtaTool.handler({ path, basis, confirm: true } as never, ctx)) as {
      nodeCount: number;
    };
    expect(result.nodeCount).toBe(1);
    expect(readFileSync(path, "latin1")).toContain('0 "static_prop" -1');
  });
});
