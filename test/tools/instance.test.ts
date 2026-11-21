import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { inspectInstance, writeInstance } from "../../src/maps/typescript/tools/instance.js";
import { FIXTURES, ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-instance-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const INSTANCE = `world
{
	"id" "1"
	"classname" "worldspawn"
	solid
	{
		"id" "2"
	}
}
entity
{
	"id" "3"
	"classname" "info_target"
}
`;

describe("inspectInstance", () => {
  it("counts solids, entities and nesting", () => {
    expect(inspectInstance(INSTANCE)).toEqual({ entities: 1, solids: 1, nested: false });
    const nested = `${INSTANCE}entity\n{\n\t"id" "4"\n\t"classname" "func_instance"\n}\n`;
    expect(inspectInstance(nested).nested).toBe(true);
  });
});

describe("write_instance", () => {
  it("adds a func_instance pointing at an existing instance file", async () => {
    const target = join(scratch, "target.vmf");
    copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), target);
    writeFileSync(join(scratch, "small.vmf"), INSTANCE, "utf8");

    const out = (await writeInstance.handler(
      {
        path: target,
        file: "small.vmf",
        origin: [0, 0, 0],
        angles: "0 0 0",
        fixupStyle: "prefix",
        confirm: true,
      },
      ctx,
    )) as { instanceSolids: number; file: string; warnings: string[] };

    expect(out.instanceSolids).toBe(1);
    expect(out.file).toBe("small.vmf");
    expect(out.warnings).toEqual([]);

    const read = readFileSync(target, "utf8");
    expect(read).toContain('"classname" "func_instance"');
    expect(read).toContain('"file" "small.vmf"');
    expect(read).toContain('"fixup_style" "0"');
  });

  it("refuses a missing instance file", async () => {
    const target = join(scratch, "target2.vmf");
    copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), target);
    await expect(
      writeInstance.handler(
        {
          path: target,
          file: "missing.vmf",
          origin: [0, 0, 0],
          angles: "0 0 0",
          fixupStyle: "prefix",
          confirm: true,
        },
        ctx,
      ),
    ).rejects.toThrow(/instance not found/);
  });
});
