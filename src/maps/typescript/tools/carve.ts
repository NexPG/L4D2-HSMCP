import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import {
  BACKUP,
  BACKUP_PATH,
  CONFIRM,
  DRY_RUN,
  resolveInput,
  resolveVmfInput,
} from "../../../core/typescript/tools/paths.js";
import {
  isEmptySelector,
  matchesSolid,
  SOLID_SELECTOR_FIELDS,
  solidSelectorFrom,
} from "../vmf/select.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { runSidecarVmf } from "./sidecarvmf.js";

/**
 * `carve_solids` is a wrapper around the sidecar's `carve_solids`, which uses
 * `srctools.geometry.Geometry.carve` — the library's already-tested convex boolean. The
 * TypeScript side resolves the project's normal `SolidSelector`, keeps the source file
 * untouched until the guarded write, and reports counts. Do not add a second boolean engine
 * or a second selector here.
 */
export const carveSolidsTool = defineTool({
  name: "carve_solids",
  description:
    "Hammer's Carve: subtracts one brush (`carver`) from the brushes named by `targets`. The " +
    "boolean is delegated to the sidecar (`srctools.geometry.Geometry.carve`), so each target " +
    "is split into the exact convex pieces that remain outside the carver; the result stays in " +
    "the target's world or brush-entity owner. The carver is removed unless `keepCarver` is " +
    "true. Newly created faces take `material` (default TOOLS/TOOLSNODRAW). Requires the " +
    "sidecar. Guarded, with backup and dry run.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    targets: z
      .object(SOLID_SELECTOR_FIELDS)
      .describe("The brushes to cut. All must belong to the same world or brush entity."),
    carver: z.number().int().describe("Hammer id of the brush that cuts the targets."),
    out: z.string().optional().describe("Output .vmf. Default: rewrite `path` in place."),
    keepCarver: z
      .boolean()
      .optional()
      .describe("Keep the carver brush in the map. Default false."),
    material: z
      .string()
      .optional()
      .describe("Material for faces created by the cut. Default TOOLS/TOOLSNODRAW."),
    overwrite: z
      .boolean()
      .optional()
      .describe("Allow replacing an existing different `out`."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    out: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    targets: z.array(z.number()),
    carver: z.number(),
    keepCarver: z.boolean(),
    newSolidIds: z.array(z.number()),
    removedTargetCount: z.number(),
    removedCarver: z.boolean(),
    owner: z.string(),
    solidCount: z.number(),
    entityCount: z.number(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const out = args.out ? resolveInput(args.out, ctx.config) : path;

    const selector = solidSelectorFrom(args.targets);
    if (isEmptySelector(selector)) {
      throw new Error(
        "refusing an empty targets selector: it would carve every brush in the map. Name " +
          "ids, an owner, a material or a bounding box.",
      );
    }
    const before = checkVmfSolids(path, readFileSync(path, "utf8"));
    const wanted = before.solids.filter((solid) => matchesSolid(solid, selector));
    if (wanted.length === 0) {
      throw new Error("nothing matched the targets selector, so there is nothing to carve");
    }
    const unnamed = wanted.filter((solid) => solid.id === null);
    if (unnamed.length > 0) {
      throw new Error(
        `${unnamed.length} matched brush(es) have no id, so they cannot be named back afterwards`,
      );
    }
    const owners = new Set(wanted.map((solid) => solid.owner));
    if (owners.size > 1) {
      throw new Error(
        `the targets span ${owners.size} owners (${[...owners].join(", ")}); carve them one ` +
          "owner at a time so the pieces have an unambiguous home",
      );
    }
    if (wanted.some((solid) => solid.id === args.carver)) {
      throw new Error("the carver cannot also be a target");
    }
    if (!before.solids.some((solid) => solid.id === args.carver)) {
      throw new Error(`no solid with id ${args.carver} in this map`);
    }
    const targetIds = wanted.map((solid) => solid.id as number);

    const run = await runSidecarVmf<{      targets: number[];
      carver: number;
      keepCarver: boolean;
      newSolidIds: number[];
      removedTargetCount: number;
      removedCarver: boolean;
      owner: string;
    }>({
      config: ctx.config,
      verb: "carve_solids",
      path,
      out,
      overwrite: args.overwrite ?? false,
      dryRun: args.dryRun,
      backup: args.backup,
      label: "carve",
      params: {
        targets: targetIds,
        carver: args.carver,
        keepCarver: args.keepCarver ?? false,
        ...(args.material ? { material: args.material } : {}),
      },
      validate: (text, reply) => {
        const after = checkVmfSolids(path, text);
        for (const id of reply.newSolidIds) {
          const piece = after.solids.find((solid) => solid.id === id);
          if (!piece) throw new Error(`the sidecar reported solid ${id}, but it is not in the map`);
          if (!piece.valid) {
            throw new Error(
              `carved solid ${id} is not a valid brush: ` +
                piece.findings.map((finding) => finding.message).join(" | "),
            );
          }
        }
      },
    });
    ctx.audit.record({
      kind: "file_write",
      data: { path: out, backup: run.write.backupPath, carved: run.reply.newSolidIds.length },
    });
    return {
      ...run.reply,
      path,
      out,
      written: run.write.written,
      backupPath: run.write.backupPath,
      solidCount: run.solidCount,
      entityCount: run.entityCount,
    };
  },
});

export const carveTools = [carveSolidsTool];
