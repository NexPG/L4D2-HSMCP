import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import type { SolidSpec } from "../../src/maps/typescript/vmf/build.js";
import { insideRoom, planSkybox, VmfSkyboxError } from "../../src/maps/typescript/vmf/skybox.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import { buildSkyboxTool, SKYBOX_ROOM_MATERIAL } from "../../src/textures/typescript/tools/skyboxbuild.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-skybox-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SKELETON =
  `versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n\t"prefab" "0"\n}\n` +
  `visgroups\n{\n}\n` +
  `world\n{\n\t"id" "1"\n\t"mapversion" "1"\n\t"classname" "worldspawn"\n` +
  `\t"skyname" "sky_l4d_c1_1_hdr"\n}\n` +
  `entity\n{\n\t"id" "2"\n\t"classname" "info_player_start"\n\t"origin" "0 0 16"\n}\n` +
  `entity\n{\n\t"id" "3"\n\t"classname" "light"\n\t"origin" "0 0 128"\n\t"_light" "255 255 255 200"\n}\n`;

const SHELL: SolidSpec[] = [
  { shape: "box", mins: [-288, -288, -32], maxs: [288, 288, 0] },
  { shape: "box", mins: [-288, -288, 256], maxs: [288, 288, 288] },
  { shape: "box", mins: [-288, -288, 0], maxs: [-256, 288, 256] },
  { shape: "box", mins: [256, -288, 0], maxs: [288, 288, 256] },
  { shape: "box", mins: [-256, -288, 0], maxs: [256, -256, 256] },
  { shape: "box", mins: [-256, 256, 0], maxs: [256, 288, 256] },
];

/** A sealed room with one interior block to copy into the skybox. */
const room = (): { text: string; blockId: number } => {
  const shell = insertSolids(SKELETON, SHELL, { material: "DEV/DEV_MEASUREGENERIC01" });
  // Away from the map origin: the scaled origin becomes the camera, and a camera inside
  // a copied brush is refused by vbsp as "entity in solid volume".
  const block = insertSolids(shell.text, [
    { shape: "box", mins: [128, 128, 0], maxs: [256, 256, 96] },
  ]);
  return { text: block.text, blockId: block.solidIds[0]! };
};

const BOUNDS = { mins: [-96, -96, 0] as const, maxs: [96, 96, 96] as const };
const MAP = { mins: [-288, -288, -32] as const, maxs: [288, 288, 288] as const };

describe("planSkybox", () => {
  it("puts the room outside the map, with the camera and the copy inside it", () => {
    const plan = planSkybox(BOUNDS, MAP);
    expect(plan.roomSolids).toHaveLength(6);
    expect(plan.scale).toBe(16);

    // The custom camera is where the map origin lands: inside the room, by construction.
    const [ox, oy, oz] = plan.origin;
    expect(ox).toBeGreaterThanOrEqual(plan.roomMins[0]);
    expect(ox).toBeLessThanOrEqual(plan.roomMaxs[0]);
    expect(oy).toBeGreaterThanOrEqual(plan.roomMins[1]);
    expect(oz).toBeGreaterThanOrEqual(plan.roomMins[2]);

    // The room is outside the playable map on the axis it was pushed along.
    const separated = [0, 1, 2].some(
      (axis) =>
        plan.outerMins[axis]! >= MAP.maxs[axis]! || plan.outerMaxs[axis]! <= MAP.mins[axis]!,
    );
    expect(separated).toBe(true);
    expect(plan.outerMins.every((v) => v >= -16384)).toBe(true);
    expect(plan.outerMaxs.every((v) => v <= 16384)).toBe(true);
  });

  it("contains a camera that a map far from the origin puts outside its own copy", () => {
    // A map at x = 4096..8192 scales to 256..512, so the point the origin maps to is well
    // outside the copy's own box. The room has to hold both.
    const far = { mins: [4096, 4096, 0] as const, maxs: [8192, 8192, 4096] as const };
    const plan = planSkybox(far, far, { origin: [-13000, 0, 0] });
    expect(plan.origin[0]).toBe(-13000);
    expect(plan.roomMins[0]).toBeLessThanOrEqual(-13000);
    expect(plan.copyMins[0] + plan.origin[0]).toBeGreaterThan(-13000);
    expect(
      insideRoom({ mins: plan.roomMins, maxs: plan.roomMaxs }, {
        mins: [plan.copyMins[0]! + plan.origin[0], 0, 0],
        maxs: [plan.copyMaxs[0]! + plan.origin[0], 0, 0],
      }),
    ).toBe(true);
  });

  it("refuses an explicit origin whose room would cut the map", () => {
    expect(() => planSkybox(BOUNDS, MAP, { origin: [0, 0, 128] })).toThrow(VmfSkyboxError);
  });

  it("refuses a room that would leave the world", () => {
    expect(() => planSkybox(BOUNDS, MAP, { origin: [16380, 0, 0] })).toThrow(/world bounds/);
  });

  it("refuses a selection with no volume", () => {
    expect(() => planSkybox({ mins: [0, 0, 0], maxs: [0, 0, 0] }, MAP)).toThrow(/no volume/);
  });
});

describe("build_skybox", () => {
  it("writes the copy, the sealed room and one camera", () => {
    const map = room();
    const file = join(scratch, "built.vmf");
    writeFileSync(file, map.text);

    const reply = buildSkyboxTool.handler(
      { path: file, solidIds: [map.blockId], backup: false, confirm: true } as never,
      ctx,
    ) as unknown as {
      origin: [number, number, number];
      scale: number;
      cloneIds: number[];
      roomSolidIds: number[];
      cameraEntityId: number | null;
      warnings: string[];
    };

    expect(reply.scale).toBe(16);
    expect(reply.cloneIds).toHaveLength(1);
    expect(reply.roomSolidIds).toHaveLength(6);
    expect(reply.cameraEntityId).not.toBeNull();

    const text = readFileSync(file, "utf8");
    expect(text.match(/"classname"\s+"sky_camera"/g)).toHaveLength(1);
    expect(text).toContain(`"scale" "16"`);
    expect(text).toContain(`"origin" "${reply.origin.map((n) => Math.round(n)).join(" ")}"`);

    const report = checkVmfSolids(file, text);
    const clone = report.solids.find((s) => s.id === reply.cloneIds[0])!;
    const camera = report.solids.find((s) => s.id === reply.cameraEntityId);
    expect(camera, "the camera is a point entity, not a solid").toBeUndefined();

    const roomIds = new Set(reply.roomSolidIds);
    const roomSolids = report.solids.filter((s) => roomIds.has(s.id!));
    expect(roomSolids).toHaveLength(6);
    for (const solid of roomSolids) {
      expect(solid.valid).toBe(true);
      expect(solid.sides.every((side) => side.material === SKYBOX_ROOM_MATERIAL)).toBe(true);
    }

    const inner = {
      mins: [
        Math.min(...roomSolids.map((s) => s.mins[0]!)),
        Math.min(...roomSolids.map((s) => s.mins[1]!)),
        Math.min(...roomSolids.map((s) => s.mins[2]!)),
      ] as [number, number, number],
      maxs: [
        Math.max(...roomSolids.map((s) => s.maxs[0]!)),
        Math.max(...roomSolids.map((s) => s.maxs[1]!)),
        Math.max(...roomSolids.map((s) => s.maxs[2]!)),
      ] as [number, number, number],
    };
    expect(clone.mins.every((v, axis) => v >= inner.mins[axis]!)).toBe(true);
    expect(clone.maxs.every((v, axis) => v <= inner.maxs[axis]!)).toBe(true);
  });

  it("refuses a selection that puts the camera inside copied geometry", () => {
    // The block spans the origin; after scaling the origin is inside it, and vbsp refuses a
    // sky_camera in solid volume. Catching it here names the selection instead of the
    // compiler naming an entity.
    const shell = insertSolids(SKELETON, SHELL, { material: "DEV/DEV_MEASUREGENERIC01" });
    const block = insertSolids(shell.text, [
      { shape: "box", mins: [-96, -96, 0], maxs: [96, 96, 96] },
    ]);
    const file = join(scratch, "in-solid.vmf");
    writeFileSync(file, block.text);
    expect(() =>
      buildSkyboxTool.handler(
        { path: file, solidIds: [block.solidIds[0]!], backup: false, confirm: true } as never,
        ctx,
      ),
    ).toThrow(/scaled map origin falls inside copied brush/);
  });

  it("refuses a map that already has a camera", async () => {
    const map = room();
    const file = join(scratch, "second.vmf");
    writeFileSync(file, map.text);
    await buildSkyboxTool.handler(
      { path: file, solidIds: [map.blockId], backup: false, confirm: true } as never,
      ctx,
    );
    expect(() =>
      buildSkyboxTool.handler(
        { path: file, solidIds: [map.blockId], backup: false, confirm: true } as never,
        ctx,
      ),
    ).toThrow(/already has a sky_camera/);
  });

  it("refuses an empty selection rather than copying the whole map", () => {
    const map = room();
    const file = join(scratch, "empty.vmf");
    writeFileSync(file, map.text);
    expect(() =>
      buildSkyboxTool.handler({ path: file, backup: false, confirm: true } as never, ctx),
    ).toThrow(/name what belongs in the skybox/);
  });

  it("does not write on a dry run", async () => {
    const map = room();
    const file = join(scratch, "dry.vmf");
    writeFileSync(file, map.text);
    await buildSkyboxTool.handler(
      { path: file, solidIds: [map.blockId], dryRun: true, backup: false, confirm: true } as never,
      ctx,
    );
    expect(readFileSync(file, "utf8")).toBe(map.text);
  });
});

describe.skipIf(!has.toolchain)("a built skybox, compiled", () => {
  it(
    "vbsp finds no leak with a second sealed volume outside the map",
    async () => {
      const map = room();
      const file = join(scratch, "compile.vmf");
      writeFileSync(file, map.text);
      await buildSkyboxTool.handler(
        { path: file, solidIds: [map.blockId], backup: false, confirm: true } as never,
        ctx,
      );

      const result = (await runCompile.handler(
        {
          vmf: file,
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
