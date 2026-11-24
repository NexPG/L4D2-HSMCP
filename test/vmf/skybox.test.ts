import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { buildSkyboxTool } from "../../src/textures/typescript/tools/skyboxbuild.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { readBspEntities } from "../../src/maps/typescript/tools/bsp.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-skybox-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SKELETON =
  `versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n}\n` +
  `world\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n\t"skyname" "sky_l4d_c1_1_hdr"\n}\n` +
  `entity\n{\n\t"id" "2"\n\t"classname" "info_player_start"\n\t"origin" "0 0 16"\n}\n`;

const SHELL = insertSolids(
  SKELETON,
  [
    { shape: "box", mins: [-512, -512, -32], maxs: [512, 512, 0] },
    { shape: "box", mins: [-512, -512, 384], maxs: [512, 512, 416] },
    { shape: "box", mins: [-544, -544, -32], maxs: [-512, 512, 416] },
    { shape: "box", mins: [512, -544, -32], maxs: [544, 512, 416] },
    { shape: "box", mins: [-512, -544, -32], maxs: [512, -512, 416] },
    { shape: "box", mins: [-512, 512, -32], maxs: [512, 544, 416] },
  ],
  { material: "DEV/DEV_MEASUREGENERIC01" },
);

describe.skipIf(!has.toolchain)("3D skybox", () => {
  it(
    "copies a tower, seals the room and places one sky_camera",
    async () => {
      const tower = insertSolids(
        SHELL.text,
        [{ shape: "box", mins: [64, 64, 0], maxs: [192, 192, 256] }],
        { material: "BRICK/BRICKWALL001A" },
      );
      const path = join(scratch, "skybox.vmf");
      writeFileSync(path, tower.text);
      const made = (await buildSkyboxTool.handler(
        { path, solidIds: [tower.solidIds[0]!], scale: 16, confirm: true } as never,
        ctx,
      )) as unknown as {
        origin: [number, number, number];
        cloneIds: number[];
        roomSolidIds: number[];
      };
      expect(made.origin).toHaveLength(3);
      expect(made.cloneIds.length).toBeGreaterThan(0);
      expect(made.roomSolidIds.length).toBeGreaterThan(0);

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
      expect(entities.histogram.sky_camera ?? 0).toBe(1);
    },
    300_000,
  );
});
