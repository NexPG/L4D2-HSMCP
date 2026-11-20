/**
 * A geometry tool that a mapper trusts, checked by the compiler it runs into.
 *
 * `clip_solids` is the operation whose result is hardest to verify by reading: a cut brush is
 * four new planes and a new face, and vbsp is the only thing that says whether they enclose
 * anything. The cut brushes are added to a sealed room here and the room is compiled; a leak
 * would be a failure of the cut, not of the hand-written shell.
 *
 * `write_displacements` is deliberately **not** in this test. A sealed room whose floor is
 * displaced leaks, and the same room without the displacement seals -- see the diary entry for
 * 2026-11-21. That is a defect in the displacement writer, not in the room, and it needs its
 * own investigation before it can be asserted here.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { clipSolids } from "../../src/maps/typescript/vmf/clip.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import type { SolidSpec } from "../../src/maps/typescript/vmf/build.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-tools-compile-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SKELETON =
  `versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n\t"prefab" "0"\n}\n` +
  `visgroups\n{\n}\n` +
  `world\n{\n\t"id" "1"\n\t"mapversion" "1"\n\t"classname" "worldspawn"\n` +
  `\t"skyname" "sky_day01_01"\n}\n` +
  `entity\n{\n\t"id" "2"\n\t"classname" "info_player_start"\n\t"origin" "0 0 16"\n}\n` +
  `entity\n{\n\t"id" "3"\n\t"classname" "light"\n\t"origin" "0 0 128"\n\t"_light" "255 255 255 200"\n}\n`;

/** A sealed 576x576 room: floor, ceiling and four walls. */
const SHELL: SolidSpec[] = [
  { shape: "box", mins: [-288, -288, -32], maxs: [288, 288, 0] },
  { shape: "box", mins: [-288, -288, 256], maxs: [288, 288, 288] },
  { shape: "box", mins: [-288, -288, 0], maxs: [-256, 288, 256] },
  { shape: "box", mins: [256, -288, 0], maxs: [288, 288, 256] },
  { shape: "box", mins: [-256, -288, 0], maxs: [256, -256, 256] },
  { shape: "box", mins: [-256, 256, 0], maxs: [256, 288, 256] },
];

describe.skipIf(!has.toolchain)("a clipped room compiled for real", () => {
  it(
    "vbsp accepts both halves of a cut brush with no leak",
    async () => {
      const room = insertSolids(SKELETON, SHELL, { material: "DEV/DEV_MEASUREGENERIC01" });
      const withBlock = insertSolids(room.text, [
        { shape: "box", mins: [-96, -96, 0], maxs: [96, 96, 96] },
      ]);
      const cut = clipSolids(
        withBlock.text,
        { ids: [withBlock.solidIds[0]!] },
        { normal: [1, 0, 0], dist: 0 },
        { keep: "both" },
      );
      expect(cut.solids[0]?.otherId).not.toBeNull();

      const path = join(scratch, "clipped_room.vmf");
      writeFileSync(path, cut.text);
      const result = (await runCompile.handler(
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
      )) as { ok: boolean; leaked: boolean; bspExists: boolean };

      expect(result.leaked).toBe(false);
      expect(result.bspExists).toBe(true);
      expect(result.ok).toBe(true);
    },
    300_000,
  );
});
