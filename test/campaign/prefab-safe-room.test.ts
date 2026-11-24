import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { writeSafeRoomPrefabTool, writeChangelevelTool } from "../../src/campaigns/typescript/tools/campaignbuild.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { readBspEntities } from "../../src/maps/typescript/tools/bsp.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-safe-prefab-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SKELETON =
  `versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n}\n` +
  `world\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n\t"skyname" "sky_l4d_c1_1_hdr"\n}\n` +
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

describe.skipIf(!has.gameContent || !has.toolchain)("safe room from a prefab", () => {
  it(
    "places prop_swamphouse01, wires the checkpoint and continues to a changelevel",
    async () => {
      const path = join(scratch, "safe_room_prefab.vmf");
      writeFileSync(path, ROOM);
      const made = (await writeSafeRoomPrefabTool.handler(
        {
          path,
          prefab: "prop_swamphouse01",
          origin: [0, 0, 0],
          role: "exit",
          opening: { axis: "x", min: -32, max: 32, at: -288, floorZ: 0 },
          doorYaw: 90,
          playerStart: { origin: [-128, 0, 16], angles: [0, 0, 0] },
          confirm: true,
        } as never,
        ctx,
      )) as unknown as {
        doorId: number | null;
        playerStartId: number | null;
        survivorIds: number[];
        directorId: number | null;
        duplicates: Array<{ name: string }>;
        unresolvedOutputs: string[];
        prefabSolids: number;
      };
      expect(made.prefabSolids).toBeGreaterThan(0);
      expect(made.doorId).not.toBeNull();
      expect(made.playerStartId).not.toBeNull();
      expect(made.survivorIds).toHaveLength(4);
      expect(made.directorId).not.toBeNull();
      expect(made.duplicates).toEqual([]);
      expect(made.unresolvedOutputs).toEqual([]);

      await writeChangelevelTool.handler(
        {
          path,
          role: "departure",
          map: "next_chapter",
          landmark: "lm_safe_room",
          bounds: { mins: [-224, -320, 0], maxs: [-160, -256, 128] },
          material: "TOOLS/TOOLSTRIGGER",
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
      expect(entities.histogram.prop_door_rotating_checkpoint ?? 0).toBe(1);
      expect(entities.histogram.info_player_start ?? 0).toBe(1);
      expect(entities.histogram.info_survivor_position ?? 0).toBe(4);
      expect(entities.histogram.info_changelevel ?? 0).toBe(1);
      expect(entities.histogram.info_landmark ?? 0).toBe(1);

      const door = (await readBspEntities.handler(
        {
          path: compiled.bsp,
          limit: 1,
          offset: 0,
          histogramOnly: false,
          classname: "prop_door_rotating_checkpoint",
        },
        ctx,
      )) as unknown as { entities: Array<{ targetname: string | null }> };
      expect(door.entities[0]?.targetname).toBe("checkpoint_exit");
    },
    300_000,
  );
});
