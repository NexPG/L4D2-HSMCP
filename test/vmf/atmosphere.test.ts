import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { editVmf } from "../../src/maps/typescript/tools/vmfedit.js";
import {
  writeAtmosphereVolumeTool,
  writeEnvWindTool,
  writeLightTool,
  writePostprocessTool,
} from "../../src/maps/typescript/tools/dressing.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { readBspEntities } from "../../src/maps/typescript/tools/bsp.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-atmosphere-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SKELETON =
  `versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n}\n` +
  `world\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n\t"skyname" "sky_l4d_c1_1_hdr"\n}\n` +
  `entity\n{\n\t"id" "2"\n\t"classname" "info_player_start"\n\t"origin" "0 0 16"\n}\n`;

const ROOM = insertSolids(
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
).text;

describe.skipIf(!has.toolchain)("map atmosphere", () => {
  it(
    "writes sun, shadow, wind, three fog controllers, three tonemaps and a colour correction",
    async () => {
      const path = join(scratch, "atmosphere.vmf");
      writeFileSync(path, ROOM);

      await writeLightTool.handler(
        {
          path,
          kind: "environment",
          origin: [0, 0, 300],
          angles: [-52, 245, 0],
          color: [255, 242, 216],
          brightness: 850,
          ambient: [140, 160, 188],
          ambientBrightness: 190,
          confirm: true,
        } as never,
        ctx,
      );
      await writeLightTool.handler(
        {
          path,
          kind: "sun",
          origin: [0, 0, 300],
          angles: [-52, 245, 0],
          color: [255, 242, 216],
          brightness: 850,
          confirm: true,
        } as never,
        ctx,
      );
      await writeLightTool.handler(
        { path, kind: "shadow", origin: [0, 0, 0], color: [40, 48, 60], brightness: 120, confirm: true } as never,
        ctx,
      );

      await editVmf.handler(
        {
          path,
          ops: [
            {
              op: "add",
              keyvalues: {
                classname: "env_fog_controller",
                targetname: "fog_exterior",
                origin: "0 0 64",
                fogenable: "1",
                fogcolor: "190 202 214",
                fogstart: "1200",
                fogend: "5200",
                fogmaxdensity: "0.55",
              },
            },
            {
              op: "add",
              keyvalues: {
                classname: "env_fog_controller",
                targetname: "fog_interior",
                origin: "0 0 64",
                fogenable: "0",
                fogcolor: "120 110 100",
                fogstart: "256",
                fogend: "900",
              },
            },
            {
              op: "add",
              keyvalues: {
                classname: "env_fog_controller",
                targetname: "fog_fire",
                origin: "0 0 64",
                fogenable: "0",
                fogcolor: "90 70 60",
                fogstart: "128",
                fogend: "512",
              },
            },
            {
              op: "add",
              keyvalues: {
                classname: "postprocess_controller",
                targetname: "pp_main",
                origin: "0 0 64",
              },
            },
          ],
          confirm: true,
        } as never,
        ctx,
      );

      await writeEnvWindTool.handler(
        {
          path,
          origin: [0, 0, 0],
          angles: [0, 245, 0],
          minWind: 20,
          maxWind: 50,
          windRadius: -1,
          minGust: 100,
          maxGust: 250,
          minGustDelay: 10,
          maxGustDelay: 20,
          gustDuration: 5,
          gustDirectionChange: 20,
          confirm: true,
        } as never,
        ctx,
      );

      for (const [targetname, infected, ghost] of [
        ["tonemap_global", false, false],
        ["tonemap_infected", true, false],
        ["tonemap_ghost", false, true],
      ] as const) {
        await writePostprocessTool.handler(
          {
            path,
            kind: infected ? "tonemap" : ghost ? "tonemap" : "tonemap",
            origin: [0, 0, 64],
            targetname,
            exposureMin: 0.5,
            exposureMax: 1.5,
            bloomScale: 1,
            tonemapRate: 0,
            confirm: true,
          } as never,
          ctx,
        );
      }
      await writePostprocessTool.handler(
        {
          path,
          kind: "colorcorrection",
          origin: [0, 0, 64],
          targetname: "cc_main",
          correctionFile: "materials/color_correction/dawn.raw",
          minFalloff: 200,
          maxFalloff: 1200,
          maxWeight: 0.8,
          confirm: true,
        } as never,
        ctx,
      );

      await writeAtmosphereVolumeTool.handler(
        {
          path,
          mins: [-256, -256, 0],
          maxs: [256, 256, 128],
          fog: "fog_interior",
          postprocess: "pp_main",
          colorCorrection: "cc_main",
          confirm: true,
        } as never,
        ctx,
      );

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
      expect(entities.histogram.env_fog_controller ?? 0).toBe(3);
      expect(entities.histogram.env_tonemap_controller ?? 0).toBe(3);
      expect(entities.histogram.color_correction ?? 0).toBe(1);
      expect(entities.histogram.env_sun ?? 0).toBe(1);
      expect(entities.histogram.shadow_control ?? 0).toBe(1);
      expect(entities.histogram.env_wind ?? 0).toBe(1);
      expect(entities.histogram.fog_volume ?? 0).toBe(1);
      expect(entities.histogram.postprocess_controller ?? 0).toBe(1);
      expect(entities.histogram.light_environment ?? 0).toBe(1);
    },
    300_000,
  );
});
