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
import { transformSolidsTool } from "../../src/maps/typescript/tools/modify.js";
import { writeVmfFittingTool } from "../../src/maps/typescript/tools/build.js";
import { writeHintBrushTool } from "../../src/maps/typescript/tools/optimise.js";
import { writePortalTool } from "../../src/maps/typescript/tools/wiring.js";
import { writeOverlay } from "../../src/maps/typescript/tools/overlay.js";
import { moveVerticesTool } from "../../src/maps/typescript/tools/vertex.js";
import { clipSolids } from "../../src/maps/typescript/vmf/clip.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import type { SolidSpec } from "../../src/maps/typescript/vmf/build.js";
import { applyVmfOps } from "../../src/maps/typescript/vmf/edit.js";
import { setCordon } from "../../src/maps/typescript/vmf/organise.js";
import { sealDisplacements } from "../../src/maps/typescript/vmf/dispseal.js";
import { writeDisplacements } from "../../src/maps/typescript/vmf/dispwrite.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import { readEntityLump } from "../../src/maps/typescript/bsp/entities.js";
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
async function compile(
  path: string,
  extra: Record<string, unknown> = {},
): Promise<{
  ok: boolean;
  leaked: boolean;
  bspExists: boolean;
  bsp: string;
  stages: Array<{ stage: string; clean: boolean; exitCode: number | null }>;
  cordon: { applied: boolean; active: boolean; removedSolids: number; removedEntities: number };
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
      ...extra,
    } as never,
    ctx,
  )) as {
    ok: boolean;
    leaked: boolean;
    bspExists: boolean;
    bsp: string;
    stages: Array<{ stage: string; clean: boolean; exitCode: number | null }>;
    cordon: { applied: boolean; active: boolean; removedSolids: number; removedEntities: number };
  };
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

describe.skipIf(!has.toolchain)("a cordon, applied before vbsp", () => {
  it(
    "the room compiles alone, and the leaky structure outside it is not in the BSP",
    async () => {
      // Five brushes and a light in an open-topped box, far from the room. Without the
      // cordon the light sees the void and vbsp leaks; with it the box is never handed to
      // the compiler. The control compile is what makes the second one evidence.
      const withOutside = insertSolids(room(), [
        { shape: "box", mins: [4000, -128, -32], maxs: [4256, 128, 0] },
        { shape: "box", mins: [4000, -128, 0], maxs: [4032, 128, 128] },
        { shape: "box", mins: [4224, -128, 0], maxs: [4256, 128, 128] },
        { shape: "box", mins: [4032, -128, 0], maxs: [4224, -96, 128] },
        { shape: "box", mins: [4032, 96, 0], maxs: [4224, 128, 128] },
      ]);
      const withLight = applyVmfOps(withOutside.text, [
        { op: "add", keyvalues: { classname: "light", origin: "4128 0 32", _light: "255 255 255 200" } },
      ]);
      const cordoned = setCordon(
        withLight.text,
        { mins: [-400, -400, -100], maxs: [400, 400, 400] },
        { active: true },
      );

      const path = join(scratch, "cordoned_room.vmf");
      writeFileSync(path, cordoned.text);

      // Control: the cordon is on, but the whole map is compiled. It must leak, or the
      // second compile proves nothing about filtering.
      const whole = await compile(path, { ignoreCordon: true });
      expect(whole.leaked).toBe(true);

      const onlyRoom = await compile(path);
      expect(onlyRoom.cordon.active).toBe(true);
      expect(onlyRoom.cordon.applied).toBe(true);
      expect(onlyRoom.cordon.removedSolids).toBe(5);
      expect(onlyRoom.cordon.removedEntities).toBe(1);
      expect(onlyRoom.leaked).toBe(false);
      expect(onlyRoom.bspExists).toBe(true);
      expect(onlyRoom.ok).toBe(true);

      // The BSP landed under the map's real name, not the temp copy's, and the outside
      // light is not in its entity lump.
      expect(onlyRoom.bsp).toBe(join(scratch, "cordoned_room.bsp"));
      const lump = readEntityLump(onlyRoom.bsp);
      expect(lump.text).not.toContain('"origin" "4128 0 32"');
      expect(lump.text).toContain('"origin" "0 0 128"');
    },
    300_000,
  );
});

describe.skipIf(!has.toolchain)("geometry tools the compiler has to believe", () => {
  it(
    "a rotated and scaled brush, a counter and a two-plane clip compile",
    async () => {
      const path = join(scratch, "shaped_room.vmf");
      const added = insertSolids(room(), [
        { shape: "box", mins: [-96, -96, 0], maxs: [96, 96, 96] },
      ]);
      writeFileSync(path, added.text);
      const blockId = added.solidIds[0]!;

      // Rotate about the brush's centre, then stretch it. Two calls because the tool
      // refuses to combine transforms: a result must have one cause.
      transformSolidsTool.handler(
        {
          path,
          solidIds: [blockId],
          rotate: { axis: [0, 0, 1], degrees: 30 },
          backup: false,
          confirm: true,
        } as never,
        ctx,
      );
      transformSolidsTool.handler(
        {
          path,
          solidIds: [blockId],
          scale: { factor: [1.4, 0.8, 1.0] },
          textureLock: false,
          backup: false,
          confirm: true,
        } as never,
        ctx,
      );

      const shaped = readFileSync(path, "utf8");
      const rotated = checkVmfSolids(path, shaped).solids.find((s) => s.id === blockId)!;
      expect(rotated.valid).toBe(true);

      // A counter is several brushes that must join: the fitting tool checks the assembly,
      // vbsp checks that each part is a closed volume.
      writeVmfFittingTool.handler(
        {
          path,
          fittings: [
            {
              fitting: "counter",
              mins: [-220, -220, 0],
              maxs: [-160, -120, 56],
              facing: "+x",
            },
          ],
          backup: false,
          confirm: true,
        } as never,
        ctx,
      );

      // Two planes: Hammer's 3-point clip is two ordinary cuts, and each one is checked by
      // the same volume conservation the single-clip test uses.
      const beforeCut = readFileSync(path, "utf8");
      const cutX = clipSolids(
        beforeCut,
        { ids: [blockId] },
        { normal: [1, 0, 0], dist: 0 },
        { keep: "both" },
      );
      expect(cutX.solids[0]?.otherId).not.toBeNull();
      const ids = [cutX.solids[0]!.id, cutX.solids[0]!.otherId!];
      const cutY = clipSolids(cutX.text, { ids }, { normal: [0, 1, 0], dist: 0 }, { keep: "both" });
      expect(cutY.solids.every((s) => s.otherId !== null)).toBe(true);
      writeFileSync(path, cutY.text);

      // Mirror one of the four pieces. The tool's own check is that the volume is preserved
      // by a reflection; the compile is the check that the planes still bound a brush.
      transformSolidsTool.handler(
        {
          path,
          solidIds: [cutY.solids[0]!.id],
          mirror: { axis: "x" },
          backup: false,
          confirm: true,
        } as never,
        ctx,
      );

      for (const solid of checkVmfSolids(path, readFileSync(path, "utf8")).solids) {
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

describe.skipIf(!has.toolchain)("visibility tools, compiled with vvis", () => {
  it(
    "a hint slab and an areaportal in a doorway survive vbsp and vvis",
    async () => {
      // The +x wall is split around a 64x128 doorway; the other five faces are unchanged.
      // Beyond the doorway is a second sealed room, because an areaportal separates two
      // areas of the map -- a doorway to the void leaks whatever is hung in it.
      const shellWithDoor: SolidSpec[] = [
        { shape: "box", mins: [-288, -288, -32], maxs: [288, 288, 0] },
        { shape: "box", mins: [-288, -288, 256], maxs: [288, 288, 288] },
        { shape: "box", mins: [-288, -288, 0], maxs: [-256, 288, 256] },
        { shape: "box", mins: [-256, -288, 0], maxs: [256, -256, 256] },
        { shape: "box", mins: [-256, 256, 0], maxs: [256, 288, 256] },
        // +x wall, with the doorway at y -32..32, z 0..128.
        { shape: "box", mins: [256, -288, 0], maxs: [288, -32, 256] },
        { shape: "box", mins: [256, 32, 0], maxs: [288, 288, 256] },
        { shape: "box", mins: [256, -32, 128], maxs: [288, 32, 256] },
        // The annex on the far side: floor, ceiling and three walls, open only at the
        // doorway where the portal goes.
        { shape: "box", mins: [288, -128, -32], maxs: [576, 128, 0] },
        { shape: "box", mins: [288, -128, 128], maxs: [576, 128, 160] },
        { shape: "box", mins: [576, -128, 0], maxs: [608, 128, 128] },
        { shape: "box", mins: [288, -160, 0], maxs: [576, -128, 128] },
        { shape: "box", mins: [288, 128, 0], maxs: [576, 160, 128] },
      ];
      const path = join(scratch, "visibility_room.vmf");
      writeFileSync(path, insertSolids(SKELETON, shellWithDoor, { material: "DEV/DEV_MEASUREGENERIC01" }).text);

      writeHintBrushTool.handler(
        {
          path,
          mins: [-64, -200, 64],
          maxs: [64, 200, 80],
          backup: false,
          confirm: true,
        } as never,
        ctx,
      );

      writePortalTool.handler(
        {
          path,
          classname: "func_areaportal",
          mins: [256, -32, 0],
          maxs: [288, 32, 128],
          backup: false,
          confirm: true,
        } as never,
        ctx,
      );

      const result = await compile(path, { stages: ["vbsp", "vvis"] });
      expect(result.leaked).toBe(false);
      expect(result.stages.map((s) => s.stage)).toEqual(["vbsp", "vvis"]);
      for (const stage of result.stages) {
        expect(stage.clean, `${stage.stage} exit ${stage.exitCode}`).toBe(true);
      }
      expect(result.ok).toBe(true);
    },
    300_000,
  );
});