import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { writeNavProbeTool } from "../../src/scripts/typescript/tools/navprobe.js";
import { readEntities } from "../../src/maps/typescript/vmf/edit.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-navprobe-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n}\n';

let counter = 0;
function map(): string {
  counter += 1;
  const path = join(scratch, `navprobe-${counter}.vmf`);
  writeFileSync(path, SEED);
  return path;
}

describe("write_nav_probe", () => {
  it("writes the live attribute test and its markers", async () => {
    const path = map();
    const result = (await writeNavProbeTool.handler(
      {
        path,
        points: [
          { name: "rescue", origin: [-160, 0, 16], attributes: ["rescue_closet"] },
          { name: "start", origin: [0, 0, 16], attributes: ["checkpoint"] },
        ],
        atSeconds: 8,
        confirm: true,
      } as never,
      ctx,
    )) as {
      scriptPath: string;
      logicScriptId: number;
      markers: Array<{ name: string; pattern: string }>;
    };

    const script = readFileSync(result.scriptPath, "utf8");
    expect(script).toContain("HasSpawnAttributes");
    expect(script).toContain("65536");
    expect(script).toContain("2048");
    expect(script).toContain("HSMCP_NAV_DONE");
    expect(result.markers.map((marker) => marker.name)).toEqual([
      "rescue_attribute",
      "start_attribute",
      "nav_probe_done",
    ]);
    expect(result.markers[0]!.pattern).toBe("HSMCP_NAV rescue HAS");

    const entity = readEntities(readFileSync(path, "utf8")).entities.find(
      (entry) => entry.id === result.logicScriptId,
    )!;
    expect(entity.classname).toBe("logic_script");
    expect(entity.keyvalues["vscripts"]).toBe("hsmcp_nav_probe");
  });
});
