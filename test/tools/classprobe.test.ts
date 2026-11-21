import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { checkNut } from "../../src/scripts/typescript/vscript/check.js";
import { writeClassProbeTool } from "../../src/scripts/typescript/tools/classprobe.js";
import { readEntities } from "../../src/maps/typescript/vmf/edit.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-classprobe-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n}\n';

let counter = 0;
function map(): string {
  counter += 1;
  const path = join(scratch, `probe-${counter}.vmf`);
  writeFileSync(path, SEED);
  return path;
}

describe("write_class_probe", () => {
  it("writes a logic_script, a checked .nut and presence markers", async () => {
    const path = map();
    const result = (await writeClassProbeTool.handler(
      {
        path,
        classes: ["weapon_rifle", "infected"],
        atSeconds: [5, 10],
        confirm: true,
      } as never,
      ctx,
    )) as {
      scriptPath: string;
      scriptsDir: string;
      logicScriptId: number;
      markers: Array<{ name: string; pattern: string }>;
    };

    const script = readFileSync(result.scriptPath, "utf8");
    expect(checkNut(script).ok).toBe(true);
    expect(script).toContain("HSMCP_ClassProbe");
    expect(script).toContain('"weapon_rifle"');
    expect(script).toContain("HSMCP_CLASS_DONE");

    expect(result.markers.map((marker) => marker.name)).toEqual([
      "weapon_rifle_present",
      "infected_present",
      "class_probe_done",
    ]);
    expect(result.markers[0]!.pattern).toBe("HSMCP_CLASS 1 weapon_rifle [1-9][0-9]*");

    const entity = readEntities(readFileSync(path, "utf8")).entities.find(
      (entry) => entry.id === result.logicScriptId,
    )!;
    expect(entity.classname).toBe("logic_script");
    expect(entity.keyvalues["vscripts"]).toBe("hsmcp_class_probe");
  });

  it("refuses samples that are not ascending", async () => {
    const path = map();
    await expect(
      writeClassProbeTool.handler(
        {
          path,
          classes: ["weapon_rifle"],
          atSeconds: [10, 5],
          confirm: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/ascending/);
  });

  it("prints origins at the final sample when asked", async () => {
    const path = map();
    const result = (await writeClassProbeTool.handler(
      {
        path,
        classes: ["infected"],
        atSeconds: [10, 20],
        positions: true,
        maxPositions: 25,
        confirm: true,
      } as never,
      ctx,
    )) as { scriptPath: string };
    const script = readFileSync(result.scriptPath, "utf8");
    expect(script).toContain("HSMCP_CLASS_POS");
    expect(script).toContain("shown < 25");
  });
});
