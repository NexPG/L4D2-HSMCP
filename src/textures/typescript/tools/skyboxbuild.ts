import { readFileSync } from "node:fs";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { applyVmfOps } from "../../../maps/typescript/vmf/edit.js";
import { cloneSolids } from "../../../maps/typescript/vmf/clone.js";
import { insertSolids } from "../../../maps/typescript/vmf/build.js";
import { matchesSolid } from "../../../maps/typescript/vmf/select.js";
import type { SolidSelector } from "../../../maps/typescript/vmf/select.js";
import { checkVmfSolids, WORLD_BOUND } from "../../../maps/typescript/vmf/solid.js";
import type { Vec3 } from "../../../maps/typescript/vmf/solid.js";
import { insideRoom, planSkybox, pointInsideSolid } from "../../../maps/typescript/vmf/skybox.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveVmfInput } from "../../../core/typescript/tools/paths.js";

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

/** The texture a skybox room's inner faces carry so the 2D sky shows through. */
export const SKYBOX_ROOM_MATERIAL = "TOOLS/TOOLSSKYBOX";

const union = (
  boxes: ReadonlyArray<{ mins: readonly [number, number, number]; maxs: readonly [number, number, number] }>,
): { mins: Vec3; maxs: Vec3 } => {
  const mins: number[] = [Infinity, Infinity, Infinity];
  const maxs: number[] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      mins[axis] = Math.min(mins[axis]!, box.mins[axis]!);
      maxs[axis] = Math.max(maxs[axis]!, box.maxs[axis]!);
    }
  }
  return { mins: mins as unknown as Vec3, maxs: maxs as unknown as Vec3 };
};

/**
 * The whole 3D skybox in one call: copy, room, camera.
 *
 * `write_skybox_copy` performs the copy and refuses to invent anything else, which left the
 * mapper with two of the four things a 3D skybox needs. This tool adds the other two: a
 * sealed room placed outside the playable map, and the single `sky_camera` at the scaled map
 * origin. The room's inner faces are `TOOLS/TOOLSSKYBOX`, so a gap in the copied geometry
 * shows the 2D sky rather than the void.
 *
 * What it still refuses to decide is what is worth copying: that is the selection, and it
 * must be named. It also refuses a map that already has a camera, a selection that overlaps
 * the map (the room would cut it), and a room that would reach outside the world bounds.
 */
export const buildSkyboxTool = defineTool({
  name: "build_skybox",
  description:
    "Builds a complete 3D skybox from a selection: copies the brushes at 1/scale around the " +
    "map origin, moves the copy to a free area outside the playable map, encloses it in a " +
    "sealed room textured TOOLS/TOOLSSKYBOX, and places the single sky_camera at the scaled " +
    "origin. The room is mitred and checked to lie inside the world bounds and outside the " +
    "map. Refuses a map that already has a sky_camera, hidden or displaced brushes (as " +
    "clone_solids does), and an explicit origin whose room would overlap the map. Warns " +
    "when worldspawn has no skyname, because a 3D skybox is drawn against the 2D one. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidIds: z.array(z.number()).optional().describe("Brushes to copy into the skybox."),
    within: z
      .object({ mins: Vec3Schema, maxs: Vec3Schema })
      .optional()
      .describe("Copy brushes lying entirely inside this box."),
    owner: z.string().optional().describe("'world' or a brush entity classname."),
    material: z
      .string()
      .optional()
      .describe("Copy brushes carrying this material. Substring, case-insensitive."),
    origin: Vec3Schema.optional().describe(
      "Where the scaled map origin lands: the sky_camera's position. Omit to place the " +
        "room in the first free direction outside the map.",
    ),
    scale: z
      .number()
      .int()
      .min(2)
      .max(64)
      .optional()
      .describe("How much smaller the copy is. Default 16, Hammer's own skybox scale."),
    margin: z
      .number()
      .positive()
      .optional()
      .describe("Skybox units between the copy or camera and the room's inner wall. Default 32."),
    wallThickness: z
      .number()
      .positive()
      .optional()
      .describe("Thickness of the room's walls, floor and ceiling. Default 16."),
    roomMaterial: z
      .string()
      .optional()
      .describe(`Material for the room. Default ${SKYBOX_ROOM_MATERIAL}.`),
    light: z
      .boolean()
      .optional()
      .describe(
        "Add a `light` inside the room. Off by default: light_environment reaches the " +
          "skybox area too, and an extra light usually overbrightens it.",
      ),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    scale: z.number(),
    origin: Vec3Schema,
    roomMins: Vec3Schema,
    roomMaxs: Vec3Schema,
    sourceSolids: z.array(z.number()),
    cloneIds: z.array(z.number()),
    roomSolidIds: z.array(z.number()),
    cameraEntityId: z.number().nullable(),
    lightEntityId: z.number().nullable(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    assertWritable(path, ctx.config);
    const before = readFileSync(path, "utf8");

    if (/"classname"\s+"sky_camera"/i.test(before)) {
      throw new Error(
        "this map already has a sky_camera; a map has exactly one 3D skybox. Move it with " +
          "edit_vmf, or build the copy with write_skybox_copy and keep the existing camera.",
      );
    }

    const selector: SolidSelector = {
      ...(args.solidIds !== undefined ? { ids: args.solidIds } : {}),
      ...(args.within !== undefined ? { within: { mins: args.within.mins, maxs: args.within.maxs } } : {}),
      ...(args.owner !== undefined ? { owner: args.owner } : {}),
      ...(args.material !== undefined ? { material: args.material } : {}),
    };
    if (Object.keys(selector).length === 0) {
      throw new Error(
        "name what belongs in the skybox: solidIds, within, owner or material. Copying the " +
          "whole map into its own skybox is never what was meant.",
      );
    }

    const report = checkVmfSolids(path, before);
    const chosen = report.solids.filter((solid) => matchesSolid(solid, selector));
    if (chosen.length === 0) {
      throw new Error("nothing matched the selector; check the ids with read_vmf_solids");
    }

    const plan = planSkybox(
      union(chosen),
      union(report.solids),
      {
        ...(args.origin !== undefined ? { origin: args.origin as Vec3 } : {}),
        ...(args.scale !== undefined ? { scale: args.scale } : {}),
        ...(args.margin !== undefined ? { margin: args.margin } : {}),
        ...(args.wallThickness !== undefined ? { wallThickness: args.wallThickness } : {}),
      },
    );

    const clone = cloneSolids(before, selector, 1, plan.matrix, { textureLock: true });
    const rooms = insertSolids(clone.text, plan.roomSolids, {
      material: args.roomMaterial?.trim() || SKYBOX_ROOM_MATERIAL,
    });

    const keyvalues: Record<string, string>[] = [
      {
        classname: "sky_camera",
        origin: plan.origin.map((n) => String(Math.round(n))).join(" "),
        angles: "0 0 0",
        scale: String(plan.scale),
      },
    ];
    if (args.light === true) {
      keyvalues.push({
        classname: "light",
        origin: [
          Math.round(plan.origin[0]),
          Math.round(plan.origin[1]),
          Math.round((plan.roomMins[2] + plan.roomMaxs[2]) / 2),
        ].join(" "),
        _light: "255 255 255 400",
      });
    }
    const added = applyVmfOps(
      rooms.text,
      keyvalues.map((kv) => ({ op: "add" as const, keyvalues: kv })),
    );

    // The oracles. Every new brush must be a valid solid, every copy must fit in the room,
    // and the room must be the six boxes the plan asked for.
    const after = checkVmfSolids(path, added.text);
    const byId = new Map(after.solids.filter((s) => s.id !== null).map((s) => [s.id!, s]));
    const roomIds = rooms.solidIds;
    for (const [index, id] of roomIds.entries()) {
      const solid = byId.get(id);
      const spec = plan.roomSolids[index]!;
      if (!solid || !solid.valid) {
        throw new Error(
          `refusing to write: room brush ${id} is not a valid solid` +
            (solid ? `: ${solid.findings.map((f) => f.message).join(" | ")}` : ""),
        );
      }
      if (
        !("mins" in spec) ||
        spec.shape !== "box" ||
        [0, 1, 2].some(
          (axis) =>
            Math.abs(solid.mins[axis]! - spec.mins[axis]!) > 0.01 ||
            Math.abs(solid.maxs[axis]! - spec.maxs[axis]!) > 0.01,
        )
      ) {
        throw new Error(`refusing to write: room brush ${id} does not match its plan`);
      }
    }
    for (const cloneId of clone.clones.map((c) => c.newId)) {
      const solid = byId.get(cloneId);
      if (!solid) throw new Error(`refusing to write: copied brush ${cloneId} is not readable`);
      if (!solid.valid) {
        throw new Error(`refusing to write: copied brush ${cloneId} is not a valid solid`);
      }
      if (!insideRoom({ mins: plan.roomMins, maxs: plan.roomMaxs }, solid, 0.01)) {
        throw new Error(
          `refusing to write: copied brush ${cloneId} sticks out of the sealed room, so the ` +
            `skybox would show it through a wall`,
        );
      }
      if (pointInsideSolid(solid, plan.origin)) {
        throw new Error(
          `refusing to write: the scaled map origin falls inside copied brush ${cloneId}, ` +
            `so the sky_camera would sit in solid volume -- vbsp refuses that outright. ` +
            `Select the distant scenery, not the room the player stands in.`,
        );
      }
    }

    const warnings: string[] = [];
    const sky = /"skyname"\s+"([^"]*)"/i.exec(before);
    if (!sky || !sky[1]!.trim()) {
      warnings.push(
        "worldspawn has no skyname: a 3D skybox is drawn against the 2D sky, so set one " +
          "with set_map_properties first",
      );
    }
    const detail = chosen.filter((solid) => solid.owner !== "world");
    if (detail.length > 0) {
      warnings.push(
        `${detail.length} copied brush(es) belong to a brush entity; their copies stay in ` +
          `that entity, which is correct for func_detail but means they are not part of the ` +
          `room's world geometry`,
      );
    }
    warnings.push(
      `the room is ${Math.round(plan.roomMaxs[0] - plan.roomMins[0])}x` +
        `${Math.round(plan.roomMaxs[1] - plan.roomMins[1])}x` +
        `${Math.round(plan.roomMaxs[2] - plan.roomMins[2])} skybox units at ` +
        `${plan.origin.map((n) => Math.round(n)).join(" ")}. The camera and the copy share ` +
        `the scaled origin; moving one without the other breaks the illusion`,
    );
    const cameraCount = (added.text.match(/"classname"\s+"sky_camera"/gi) ?? []).length;
    if (cameraCount !== 1) {
      throw new Error(`refusing to write: ${cameraCount} sky_camera entities after the build`);
    }
    if (plan.outerMins.some((v) => Math.abs(v) > WORLD_BOUND) || plan.outerMaxs.some((v) => Math.abs(v) > WORLD_BOUND)) {
      warnings.push("the room reaches the world bound; the plan should have refused this");
    }

    const write = writeGuarded(path, added.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: added.text === before,
    });

    const outcomes = added.outcomes.map((o) => o.ids[0] ?? null);
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: added.text === before,
      scale: plan.scale,
      origin: plan.origin as unknown as [number, number, number],
      roomMins: plan.roomMins as unknown as [number, number, number],
      roomMaxs: plan.roomMaxs as unknown as [number, number, number],
      sourceSolids: chosen.map((solid) => solid.id!),
      cloneIds: clone.clones.map((c) => c.newId),
      roomSolidIds: roomIds,
      cameraEntityId: outcomes[0] ?? null,
      lightEntityId: outcomes[1] ?? null,
      warnings,
      nextStep:
        "Compile and look up. A copied brush that is too tall for the room, a wall in the " +
        "wrong material or a camera at the wrong origin shows as a seam rather than as an " +
        "error, so the compass is the eye. Set skyname if it was missing.",
    };
  },
});

export const skyboxBuildTools = [buildSkyboxTool];
