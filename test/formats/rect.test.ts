import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readRectFile, writeRectFile } from "../../src/formats/typescript/formats/rect.js";
import { readRectTool, writeRectTool } from "../../src/textures/typescript/tools/rect.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-rect-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SAMPLE = `output_scale 0.5
Rectangles
{
	rectangle
	{
		"min" "0 0"
		"max" "32 64"
	}
	rectangle
	{
		"min" "32 0"
		"max" "96 64"
	}
}
`;

describe("readRectFile", () => {
  it("reads output_scale and every rectangle", () => {
    const r = readRectFile(SAMPLE);
    expect(r.outputScale).toBe(0.5);
    expect(r.rectangles).toEqual([
      { mins: [0, 0], maxs: [32, 64] },
      { mins: [32, 0], maxs: [96, 64] },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("says what is wrong rather than returning an empty list", () => {
    expect(() => readRectFile("world\n{\n}\n")).toThrow(/no `Rectangles` block/);
    expect(() => readRectFile("Rectangles\n{\n}\n")).not.toThrow();
    const empty = readRectFile("Rectangles\n{\n}\n");
    expect(empty.rectangles).toEqual([]);
    expect(empty.warnings.join(" ")).toMatch(/no usable rectangle/);
  });

  it("skips a rectangle whose max is not above its min, and says which", () => {
    const r = readRectFile(
      'Rectangles\n{\n\trectangle\n\t{\n\t\t"min" "10 10"\n\t\t"max" "10 20"\n\t}\n}\n',
    );
    expect(r.rectangles).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/max <= min/);
  });
});

describe("writeRectFile", () => {
  it("round-trips what the reader produced", () => {
    const original = readRectFile(SAMPLE);
    const text = writeRectFile(original.rectangles, { outputScale: 0.5 });
    expect(text).toContain("output_scale 0.5");
    expect(text).toContain('"min" "32 0"');
    const back = readRectFile(text);
    expect(back.outputScale).toBe(0.5);
    expect(back.rectangles).toEqual(original.rectangles);
  });

  it("omits output_scale when it is 1", () => {
    const text = writeRectFile([{ mins: [0, 0], maxs: [64, 64] }], { outputScale: 1 });
    expect(text.startsWith("Rectangles")).toBe(true);
  });

  it("refuses a degenerate or empty set", () => {
    expect(() => writeRectFile([])).toThrow(/at least one/);
    expect(() => writeRectFile([{ mins: [0, 0], maxs: [0, 16] }])).toThrow(/max above min/);
    expect(() => writeRectFile([{ mins: [0, 0], maxs: [16, 16] }], { outputScale: 0 })).toThrow(
      /positive/,
    );
  });
});

describe("read_rect / write_rect tools", () => {
  it("writes a file and reads the same rectangles back", () => {
    const path = join(scratch, "trim.rect");
    const written = writeRectTool.handler(
      {
        path,
        rectangles: [
          { mins: [0, 0], maxs: [32, 64] },
          { mins: [32, 0], maxs: [96, 64] },
        ],
        outputScale: 0.5,
        backup: false,
        confirm: true,
      } as never,
      ctx,
    ) as unknown as { written: boolean; count: number };
    expect(written.written).toBe(true);
    expect(written.count).toBe(2);

    const read = readRectTool.handler({ path } as never, ctx) as unknown as {
      count: number;
      rectangles: Array<{ mins: [number, number]; maxs: [number, number] }>;
    };
    expect(read.count).toBe(2);
    expect(read.rectangles[1]).toEqual({ mins: [32, 0], maxs: [96, 64] });

    // A second identical write is a no-op and does not touch the file.
    const again = writeRectTool.handler(
      {
        path,
        rectangles: [
          { mins: [0, 0], maxs: [32, 64] },
          { mins: [32, 0], maxs: [96, 64] },
        ],
        outputScale: 0.5,
        backup: false,
        confirm: true,
      } as never,
      ctx,
    ) as unknown as { written: boolean; unchanged: boolean };
    expect(again.written).toBe(false);
    expect(again.unchanged).toBe(true);
  });

  it("does not write on a dry run", async () => {
    const path = join(scratch, "dry.rect");
    writeFileSync(path, SAMPLE);
    const before = readFileSync(path, "utf8");
    await writeRectTool.handler(
      {
        path,
        rectangles: [{ mins: [0, 0], maxs: [8, 8] }],
        dryRun: true,
        backup: false,
        confirm: true,
      } as never,
      ctx,
    );
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});
