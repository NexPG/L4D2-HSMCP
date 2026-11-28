import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { checkAddonConflictsTool } from "../../src/packages/typescript/tools/addonconflicts.js";
import { writeVpk } from "../../src/formats/typescript/formats/vpk.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "l4d2-conflicts-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function makeVpk(name: string, title: string, files: Record<string, string>): string {
  const entries = new Map<string, Buffer>();
  entries.set(
    "addoninfo.txt",
    Buffer.from(`"addoninfo"\n{\n\t"addontitle"\t"${title}"\n}\n`),
  );
  entries.set("addonimage.jpg", Buffer.from("image"));
  for (const [path, text] of Object.entries(files)) entries.set(path, Buffer.from(text));
  const path = join(scratch, name);
  writeFileSync(path, writeVpk(entries).dir);
  return path;
}

const check = (paths: string[]) =>
  checkAddonConflictsTool.handler(
    { paths, addonsDir: undefined, includeWorkshop: true, limit: 500 } as never,
    ctx,
  ) as unknown as {
    conflicts: Array<{ kind: string; key: string; providers: string[] }>;
    summary: { addons: number; conflicts: number; byKind: Record<string, number> };
    warnings: string[];
  };

describe("check_addon_conflicts", () => {
  it("finds path, class, global and settings collisions across two add-ons", async () => {
    const script = `
class CPluginShared extends VSLU.IScriptPlugin
{
	function Load() {}
}
g_Shared <- {};
::g_AlsoShared <- {};
StringToFile("shared/settings.txt", "x");
`;
    const a = makeVpk("a.vpk", "Addon A", {
      "scripts/vscripts/director_base_addon.nut": "IncludeScript(\"a\");\n",
      "scripts/vscripts/a.nut": script,
      "materials/shared.vmt": "Material",
    });
    const b = makeVpk("b.vpk", "Addon B", {
      "scripts/vscripts/director_base_addon.nut": "IncludeScript(\"b\");\n",
      "scripts/vscripts/b.nut": script,
      "materials/shared.vmt": "Material",
    });

    const result = check([a, b]);
    const keys = result.conflicts.map((conflict) => `${conflict.kind}:${conflict.key}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        "path:materials/shared.vmt",
        "class:CPluginShared",
        "global:g_Shared",
        "global:g_AlsoShared",
        "settings:shared/settings.txt",
      ]),
    );
    for (const conflict of result.conflicts) {
      expect(conflict.providers).toHaveLength(2);
    }
    expect(keys).not.toContain("path:addoninfo.txt");
    expect(keys).not.toContain("path:addonimage.jpg");
    expect(keys).not.toContain("path:scripts/vscripts/director_base_addon.nut");
    expect(result.summary.addons).toBe(2);
    expect(result.summary.byKind.path).toBe(1);
  });

  it("reports nothing for add-ons that share only the permitted entry points", async () => {
    const a = makeVpk("unique-a.vpk", "Unique A", {
      "scripts/vscripts/director_base_addon.nut": "IncludeScript(\"a\");\n",
      "scripts/vscripts/a.nut": "class CPluginA extends VSLU.IScriptPlugin {}\ng_A <- {};\n",
      "materials/a.vmt": "A",
    });
    const b = makeVpk("unique-b.vpk", "Unique B", {
      "scripts/vscripts/director_base_addon.nut": "IncludeScript(\"b\");\n",
      "scripts/vscripts/b.nut": "class CPluginB extends VSLU.IScriptPlugin {}\ng_B <- {};\n",
      "materials/b.vmt": "B",
    });

    const result = check([a, b]);
    expect(result.conflicts).toEqual([]);
    expect(result.summary.conflicts).toBe(0);
  });
});
