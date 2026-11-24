import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { insertPrefab } from "../../src/maps/typescript/vmf/prefab.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { config, has, ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-prefab-official-"));
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

function officialPrefab(name: string): string | null {
  if (!config.gameDir) return null;
  const path = join(dirname(config.gameDir), "sdk_content", "mapsrc", "instance", `${name}.vmf`);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

describe.skipIf(!has.gameContent || !has.toolchain)("official prefab", () => {
  it(
    "pastes prop_swamphouse02 into a sealed room, renames it and compiles",
    async () => {
      const prefab = officialPrefab("prop_swamphouse02");
      if (!prefab) return;
      const result = insertPrefab(ROOM, prefab, [0, 0, 0], { namePrefix: "house_" });
      expect(result.solids).toBeGreaterThan(0);
      expect(result.entities).toBeGreaterThan(0);
      expect(result.duplicates).toEqual([]);
      expect(result.unresolvedOutputs).toEqual([]);
      expect(result.text).toContain('"targetname" "house_screen01"');

      const path = join(scratch, "prefab_room.vmf");
      writeFileSync(path, result.text);
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
      )) as unknown as { ok: boolean; leaked: boolean; stages: Array<{ stage: string }> };
      expect(compiled.leaked).toBe(false);
      expect(compiled.ok).toBe(true);
      expect(compiled.stages.map((s) => s.stage)).toEqual(["vbsp"]);
    },
    300_000,
  );
});
