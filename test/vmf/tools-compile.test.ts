/**
 * Geometry tools a mapper trusts, checked by the compiler they run into.
 *
 * Each of these produces a brush shape whose correctness is hard to prove by reading: a cut
 * brush is four new planes, a hollowed block is six mitred walls, a moved corner rewrites
 * three faces at once, and an overlay is a basis nobody can eyeball. vbsp is the oracle.
 *
 * The room is the same one every time -- 576x576, walls 32 thick -- so a failure names the
 * operation rather than the shell. A leak would be a failure of the operation, not of the
 * hand-written room, and the no-op control at the start of each case is what makes that
 * true.
 *
 * `write_displacement` used to be deliberately absent: a sealed room whose floor was
 * displaced leaked and the cause was unknown. It is known now. A displaced brush contributes
 * no volume to the hull at all -- vbsp emits its surface separately -- so the leak ran
 * *through* the floor. A duplicate brush closes it, which is what `seal_displacements` adds,
 * and both halves are asserted here: the leak without the seal, and no leak with it.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { hollowSolidsTool } from "../../src/maps/typescript/tools/hollow.js";
import { writeOverlay } from "../../src/maps/typescript/tools/overlay.js";
import { moveVerticesTool } from "../../src/maps/typescript/tools/vertex.js";
import { clipSolids } from "../../src/maps/typescript/vmf/clip.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import type { SolidSpec } from "../../src/maps/typescript/vmf/build.js";
import { sealDisplacements } from "../../src/maps/typescript/vmf/dispseal.js";
import { writeDisplacements } from "../../src/maps/typescript/vmf/dispwrite.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
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

const room = (): string => insertSolids(SKELETON, SHELL, { material: "DEV/DEV_MEASUREGENERIC01" }).text;

/** Compiles one `.vmf` with vbsp and returns what the compiler said about it. */
async function compile(path: string): Promise<{
  ok: boolean;
  leaked: boolean;
  bspExists: boolean;
  log: string;
}> {
  return (await runCompile.handler(
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
  )) as { ok: boolean; leaked: boolean; bspExists: boolean; log: string };
}

describe.skipIf(!has.toolchain)("a clipped room compiled for real", () => {
  it(
    "vbsp accepts both halves of a cut brush with no leak",
    async () => {
      const withBlock = insertSolids(room(), [
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
      const result = await compile(path);

      expect(result.leaked).toBe(false);
      expect(result.bspExists).toBe(true);
      expect(result.ok).toBe(true);
    },
    300_000,
  );
});

describe.skipIf(!has.toolchain)("the tool chain, in one room", () => {
  it(
    "hollow, a moved corner and an overlay all compile with no leak",
    async () => {
      const path = join(scratch, "tool_room.vmf");
      writeFileSync(path, room());

      // 1. A block to shape, then its top edge pulled inward: the move rewrites three faces
      // and the compiler is the only thing that says whether they still bound a volume.
      const added = insertSolids(readFileSync(path, "utf8"), [
        { shape: "box", mins: [-96, -96, 0], maxs: [96, 96, 96] },
      ]);
      writeFileSync(path, added.text);
      const blockId = added.solidIds[0]!;
      expect(added.text).toContain(`"id" "${blockId}"`);

      moveVerticesTool.handler(
        {
          path,
          solidId: blockId,
          moves: [
            { from: [96, 96, 96], to: [48, 96, 96] },
            { from: [96, -96, 96], to: [48, -96, 96] },
          ],
          backup: false,
          confirm: true,
        } as never,
        ctx,
      );
      const moved = checkVmfSolids(path, readFileSync(path, "utf8")).solids.find(
        (s) => s.id === blockId,
      )!;
      expect(moved.valid).toBe(true);

      // 2. Hollow the shaped block: six mitred walls, still one closed shell each.
      hollowSolidsTool.handler(
        {
          path,
          solidIds: [blockId],
          thickness: 8,
          direction: "in",
          backup: false,
          confirm: true,
        } as never,
        ctx,
      );

      // 3. An overlay on the ceiling's underside: a basis built from the plane, not by eye,
      // and a face the hollowed block does not cover.
      const ceiling = checkVmfSolids(path, readFileSync(path, "utf8")).solids.find((solid) =>
        solid.sides.some(
          (side) =>
            side.plane &&
            side.plane.normal[0] === 0 &&
            side.plane.normal[1] === 0 &&
            side.plane.normal[2] === -1 &&
            Math.abs(side.plane.dist + 256) < 0.01,
        ),
      )!;
      const underside = ceiling.sides.find(
        (side) =>
          side.plane &&
          side.plane.normal[0] === 0 &&
          side.plane.normal[1] === 0 &&
          side.plane.normal[2] === -1 &&
          Math.abs(side.plane.dist + 256) < 0.01,
      )!;
      expect(underside.id).not.toBeNull();
      writeOverlay.handler(
        {
          path,
          sideId: underside.id!,
          material: "decals/blood1",
          origin: [0, 0, 256],
          width: 64,
          height: 64,
          confirm: true,
        } as never,
        ctx,
      );

      const text = readFileSync(path, "utf8");
      expect(text.match(/"classname"\s+"info_overlay"/g)).toHaveLength(1);
      for (const solid of checkVmfSolids(path, text).solids) {
        expect(
          solid.valid,
          `solid ${solid.id}: ${solid.findings.map((f) => f.message).join(" | ")}`,
        ).toBe(true);
      }

      const result = await compile(path);
      expect(result.leaked).toBe(false);
      expect(result.bspExists).toBe(true);
      expect(result.ok).toBe(true);
    },
    300_000,
  );
});

describe.skipIf(!has.toolchain)("a displaced floor, with and without its seal", () => {
  it(
    "the unsealed one leaks through the brush and the sealed one does not",
    async () => {
      const shell = room();
      const floorId = checkVmfSolids("x", shell).solids.find((solid) =>
        solid.sides.some(
          (side) =>
            side.plane &&
            side.plane.normal[2] === 1 &&
            Math.abs(side.plane.dist) < 0.01,
        ),
      )!.id!;

      const displaced = writeDisplacements(shell, { solidIds: [floorId], facing: "up" }, { power: 3 });
      expect(displaced.created).toHaveLength(1);

      // The leak is the point: a displaced brush carries no volume, so the compiler walks
      // through the floor. If this ever stops leaking, the mechanism changed and the seal
      // below is no longer testing what it says it is.
      const bare = join(scratch, "displaced_bare.vmf");
      writeFileSync(bare, displaced.text);
      const open = await compile(bare);
      expect(open.leaked).toBe(true);
      expect(open.bspExists).toBe(true);

      const sealed = sealDisplacements(displaced.text, { solidIds: [floorId] });
      expect(sealed.sealed).toHaveLength(1);
      const closed = join(scratch, "displaced_sealed.vmf");
      writeFileSync(closed, sealed.text);
      const result = await compile(closed);
      expect(result.leaked).toBe(false);
      expect(result.bspExists).toBe(true);
      expect(result.ok).toBe(true);
    },
    300_000,
  );
});
