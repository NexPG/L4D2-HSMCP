import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { readBspEntities } from "../../src/maps/typescript/tools/bsp.js";
import { placeEntityGroupTool } from "../../src/maps/typescript/tools/entitygroup.js";
import { readOfficialPrefabTool } from "../../src/maps/typescript/tools/prefabcatalog.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-entitygroup-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SKELETON =
  `versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n}\n` +
  `world\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n\t"skyname" "sky_l4d_c1_1_hdr"\n}\n` +
  `entity\n{\n\t"id" "2"\n\t"classname" "info_player_start"\n\t"origin" "0 0 16"\n}\n` +
  `entity\n{\n\t"id" "3"\n\t"classname" "light"\n\t"origin" "0 0 256"\n\t"_light" "255 255 255 300"\n}\n`;

const ROOM = insertSolids(
  SKELETON,
  [
    { shape: "box", mins: [-1024, -1024, -32], maxs: [1024, 1024, 0] },
    { shape: "box", mins: [-1024, -1024, 384], maxs: [1024, 1024, 416] },
    { shape: "box", mins: [-1056, -1056, -32], maxs: [-1024, 1024, 416] },
    { shape: "box", mins: [1024, -1056, -32], maxs: [1056, 1024, 416] },
    { shape: "box", mins: [-1024, -1056, -32], maxs: [1024, -1024, 416] },
    { shape: "box", mins: [-1024, 1024, -32], maxs: [1024, 1056, 416] },
  ],
  { material: "DEV/DEV_MEASUREGENERIC01" },
).text;

describe.skipIf(!has.gameContent || !has.toolchain)("entity groups", () => {
  it("catalogues a group's script and use target", async () => {
    const r = (await readOfficialPrefabTool.handler(
      { search: "ammo_cabinet", details: false, limit: 10 },
      ctx,
    )) as unknown as {
      prefabs: Array<{
        name: string;
        scripts: string[];
        useTargets: Array<{ classname: string; vscripts: string | null }>;
      }>;
    };
    const ammo = r.prefabs.find((p) => p.name === "ammo_cabinet")!;
    expect(ammo.scripts).toContain("usetargets/emergency_ammo");
    expect(ammo.useTargets[0]).toMatchObject({
      classname: "point_script_use_target",
      vscripts: "usetargets/emergency_ammo",
    });
  });

  it(
    "places the ammo cabinet and the gascan helicopter button with their scripts",
    async () => {
      const path = join(scratch, "groups.vmf");
      writeFileSync(path, ROOM);
      const scripts = join(scratch, "scripts", "vscripts");

      const ammo = (await placeEntityGroupTool.handler(
        {
          path,
          group: "ammo_cabinet",
          origin: [-600, 0, 0],
          namePrefix: "ammo1_",
          scriptsDir: scripts,
          confirm: true,
        } as never,
        ctx,
      )) as unknown as {
        useTargets: Array<{ classname: string; vscripts: string | null }>;
        scripts: string[];
        copied: string[];
        missing: string[];
      };
      expect(ammo.useTargets[0]?.classname).toBe("point_script_use_target");
      expect(ammo.useTargets[0]?.vscripts).toBe("usetargets/emergency_ammo");
      expect(ammo.missing).toEqual([]);
      expect(existsSync(join(scripts, "usetargets", "emergency_ammo.nut"))).toBe(true);
      expect(existsSync(join(scripts, "usetargets", "base_buildable_target.nut"))).toBe(true);

      const button = (await placeEntityGroupTool.handler(
        {
          path,
          group: "gascan_helicopter_button",
          origin: [400, 0, 0],
          namePrefix: "gascan1_",
          scriptsDir: scripts,
          confirm: true,
        } as never,
        ctx,
      )) as unknown as {
        useTargets: Array<{ vscripts: string | null }>;
        missing: string[];
      };
      expect(button.useTargets[0]?.vscripts).toBe("usetargets/gascan_drop_usetarget");
      expect(button.missing).toEqual([]);

      const compiled = (await runCompile.handler(
        {
          vmf: path,
          fast: true,
          hdr: false,
          stages: ["vbsp"],
          toolchain: "stock",
          cull: false,
          timeoutMinutes: 10,
          confirm: true,
        } as never,
        ctx,
      )) as unknown as { ok: boolean; leaked: boolean; bsp: string };
      expect(compiled.leaked).toBe(false);
      expect(compiled.ok).toBe(true);
      const entities = (await readBspEntities.handler(
        { path: compiled.bsp, limit: 1, offset: 0, histogramOnly: true },
        ctx,
      )) as unknown as { histogram: Record<string, number> };
      expect(entities.histogram.point_script_use_target ?? 0).toBe(2);
      expect(entities.histogram.weapon_upgradepack_explosive_spawn ?? 0).toBe(1);
    },
    300_000,
  );
});
