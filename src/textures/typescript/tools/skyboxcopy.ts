import { readFileSync } from "node:fs";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { cloneSolids } from "../../../maps/typescript/vmf/clone.js";
import { matchesSolid } from "../../../maps/typescript/vmf/select.js";
import type { SolidSelector } from "../../../maps/typescript/vmf/select.js";
import { checkVmfSolids } from "../../../maps/typescript/vmf/solid.js";
import { compose, scaling, translation } from "../../../maps/typescript/vmf/transform.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveVmfInput } from "../../../core/typescript/tools/paths.js";

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

/**
 * The skybox copy, not the skybox design.
 *
 * A 3D skybox is a sealed area far from the playable map, containing a copy of geometry at
 * 1/16 scale around `sky_camera`. This tool performs the copy/scale/move; what to copy, where
 * the sealed room goes and how the camera is matched are the mapper's decisions. It refuses
 * to invent a room or a camera.
 */
export const writeSkyboxCopyTool = defineTool({
  name: "write_skybox_copy",
  description:
    "Copies selected brushes into a 3D skybox: scales the copy by 1/scale (16 by default) " +
    "around the map origin and moves it so that origin lands at targetOrigin, which is where " +
    "sky_camera should sit. It is the missing half of write_sky_camera; sealing the skybox " +
    "area and choosing what to copy remain the mapper's job, and the tool warns when no " +
    "sky_camera is near targetOrigin. Refuses hidden and displaced brushes; every copy is " +
    "checked as a solid before the write. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidIds: z.array(z.number()).optional().describe("Hammer ids of the brushes to copy."),
    within: z
      .object({ mins: Vec3, maxs: Vec3 })
      .optional()
      .describe("Copy brushes lying entirely inside this box."),
    owner: z.string().optional().describe("'world' or a brush entity classname."),
    material: z
      .string()
      .optional()
      .describe("Copy brushes carrying this material. Substring, case-insensitive."),
    targetOrigin: Vec3.describe(
      "Where the copy's map origin lands. Place sky_camera here; the skybox area must be " +
        "sealed around the copy.",
    ),
    scale: z
      .number()
      .int()
      .min(2)
      .max(64)
      .optional()
      .describe("How much smaller the copy is. Default 16, Hammer's own skybox scale."),
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
    targetOrigin: Vec3,
    sourceSolids: z.array(z.number()),
    cloneIds: z.array(z.number()),
    solidsBefore: z.number(),
    solidsAfter: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    assertWritable(path, ctx.config);
    const before = readFileSync(path, "utf8");
    const size = args.scale ?? 16;
    const target = args.targetOrigin as [number, number, number];

    const selector: SolidSelector = {
      ...(args.solidIds !== undefined ? { ids: args.solidIds } : {}),
      ...(args.within !== undefined
        ? { within: { mins: args.within.mins, maxs: args.within.maxs } }
        : {}),
      ...(args.owner !== undefined ? { owner: args.owner } : {}),
      ...(args.material !== undefined ? { material: args.material } : {}),
    };
    if (Object.keys(selector).length === 0) {
      throw new Error(
        "name the brushes: solidIds, within, owner or material. Copying every brush into " +
          "a skybox would duplicate the whole map.",
      );
    }

    const report = checkVmfSolids(path, before);
    const chosen = report.solids.filter((solid) => matchesSolid(solid, selector));
    if (chosen.length === 0) {
      throw new Error("nothing matched the selector; check the ids or box with read_vmf_solids");
    }

    // scale about the map origin, then move the scaled origin to targetOrigin.
    const factor = 1 / size;
    const matrix = compose(
      translation(target),
      scaling([factor, factor, factor], [0, 0, 0]),
    );
    const result = cloneSolids(before, selector, 1, matrix, { textureLock: true });
    if (result.clones.length !== chosen.length) {
      throw new Error(
        `refusing to write: ${chosen.length} source brushes but ${result.clones.length} copies`,
      );
    }

    const after = checkVmfSolids(path, result.text);
    if (after.solidCount !== report.solidCount + result.clones.length) {
      throw new Error(
        `refusing to write: ${report.solidCount} solids in, ${result.clones.length} copies, ` +
          `${after.solidCount} out`,
      );
    }
    const ids = new Set(result.clones.map((clone) => clone.newId));
    const broken = after.solids.filter((solid) => solid.id !== null && ids.has(solid.id) && !solid.valid);
    if (broken.length > 0) {
      throw new Error(
        `refusing to write: ${broken.length} copied brush(es) are not valid solids`,
      );
    }

    const warnings: string[] = [];
    const camera = /"classname"\s+"sky_camera"[\s\S]*?"origin"\s+"([^"]+)"/i.exec(before);
    if (!camera) {
      warnings.push(
        "the map has no sky_camera. Add one with write_sky_camera at targetOrigin, or the " +
          "copy is just geometry nobody sees.",
      );
    } else {
      const nums = camera[1]!.trim().split(/\s+/).map(Number);
      if (nums.length === 3 && nums.some((n, i) => Math.abs(n - target[i]!) > 1)) {
        warnings.push(
          `sky_camera is at ${camera[1]}, not targetOrigin ${target.join(" ")}. A skybox ` +
            `copy and its camera must share the origin.`,
        );
      }
    }
    warnings.push(
      "seal the skybox area around the copy; a skybox that is open to the void leaks. The " +
        "copy is still owned by the original world/entity, which is correct for geometry but " +
        "means it counts against the same compile budgets.",
    );

    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });

    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: result.unchanged,
      scale: size,
      targetOrigin: target,
      sourceSolids: chosen.map((solid) => solid.id!),
      cloneIds: result.clones.map((clone) => clone.newId),
      solidsBefore: report.solidCount,
      solidsAfter: after.solidCount,
      warnings,
      nextStep:
        "Place sky_camera at targetOrigin (or move the copy to an existing camera), seal " +
        "the skybox area, compile and look up. clone_solids and transform_solids remain " +
        "available if the selection or offset is wrong.",
    };
  },
});

export const skyboxCopyTools = [writeSkyboxCopyTool];
