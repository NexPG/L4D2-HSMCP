import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { writeNavAttributeRegionTool } from "../../src/maps/typescript/tools/navattrs.js";
import { readEntities } from "../../src/maps/typescript/vmf/edit.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-navattrs-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n}\n';

let counter = 0;
function map(): string {
  counter += 1;
  const path = join(scratch, `attrs-${counter}.vmf`);
  writeFileSync(path, SEED);
  return path;
}

describe("write_nav_attribute_region", () => {
  it("writes a rescue closet and checkpoint region as one brush", async () => {
    const path = map();
    const result = (await writeNavAttributeRegionTool.handler(
      {
        path,
        attributes: ["rescue_closet", "checkpoint"],
        bounds: { mins: [-64, -64, 0], maxs: [64, 64, 96] },
        confirm: true,
      } as never,
      ctx,
    )) as { entityId: number; spawnflags: number; solidIds: number[] };
    expect(result.spawnflags).toBe(65536 + 2048);
    expect(result.solidIds).toHaveLength(1);
    const entity = readEntities(readFileSync(path, "utf8")).entities.find(
      (entry) => entry.id === result.entityId,
    )!;
    expect(entity.classname).toBe("func_nav_attribute_region");
    expect(entity.keyvalues["spawnflags"]).toBe("67584");
    expect(entity.solidCount).toBe(1);
  });

  it("refuses an empty attribute list", async () => {
    const path = map();
    await expect(
      writeNavAttributeRegionTool.handler(
        {
          path,
          attributes: [],
          bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] },
          confirm: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/at least one/);
  });

  it("keeps the L4D2 bits distinct from the nav area flags", async () => {
    const path = map();
    const result = (await writeNavAttributeRegionTool.handler(
      {
        path,
        attributes: ["finale", "mission_start"],
        bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] },
        confirm: true,
      } as never,
      ctx,
    )) as { spawnflags: number };
    expect(result.spawnflags).toBe(64 + 128);
  });
});
