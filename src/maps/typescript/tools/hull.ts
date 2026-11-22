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
 * `hull_solids` is a wrapper around the sidecar's verb of the same name, which uses
 * `srctools.math.quickhull` and `srctools.geometry.Geometry.from_dup_planes`. The TypeScript
 * side resolves the project's normal `SolidSelector`, writes through the guarded path and
 * checks that the brush it got back is a closed volume. There is no second hull algorithm or
 * selector here.
 */
export const hullSolidsTool = defineTool({
  name: "hull_solids",
  description:
    "Builds one convex brush around the vertices of selected brushes and/or an explicit " +
    "point cloud. The hull is srctools' `quickhull` through the sidecar, so the faces are the " +
    "minimal convex set of planes. Sources stay in the map unless `keepSources` is false; the " +
    "hull joins their world or brush entity. Every face takes `material` (default " +
    "TOOLS/TOOLSNODRAW). Refuses coplanar points and a degenerate result. Requires the " +
    "sidecar. Guarded, with backup and dry run.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solids: z
      .object(SOLID_SELECTOR_FIELDS)
      .optional()
      .describe("Brushes whose vertices feed the hull. All must share one owner."),
    points: z
      .array(z.tuple([z.number(), z.number(), z.number()]))
      .optional()
      .describe("Extra hull points, in world units. Combined with `solids` when both are given."),
    out: z.string().optional().describe("Output .vmf. Default: rewrite `path` in place."),
    material: z
      .string()
      .optional()
      .describe("Material for every hull face. Default TOOLS/TOOLSNODRAW."),
    keepSources: z
      .boolean()
      .optional()
      .describe("Keep the source brushes. Default true, so a hull cannot delete geometry."),
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
    solidIds: z.array(z.number()),
    newSolidId: z.number(),
    pointCount: z.number(),
    planeCount: z.number(),
    keepSources: z.boolean(),
    removedSourceCount: z.number(),
    owner: z.string(),
    solidCount: z.number(),
    entityCount: z.number(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const out = args.out ? resolveInput(args.out, ctx.config) : path;
    if (!args.solids && !args.points?.length) {
      throw new Error("give solids, points, or both: a hull needs vertices");
    }

    let sourceIds: number[] = [];
    if (args.solids) {
      const selector = solidSelectorFrom(args.solids);
      if (isEmptySelector(selector)) {
        throw new Error(
          "the solids selector names nothing, so it would feed every brush in the map into " +
            "the hull. Name ids, an owner, a material or a bounding box.",
        );
      }
      const before = checkVmfSolids(path, readFileSync(path, "utf8"));
      const wanted = before.solids.filter((solid) => matchesSolid(solid, selector));
      if (wanted.length === 0) {
        throw new Error("nothing matched the solids selector, so there is nothing to hull");
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
          `the sources span ${owners.size} owners (${[...owners].join(", ")}); hull them one ` +
            "owner at a time so the result has an unambiguous home",
        );
      }
      sourceIds = wanted.map((solid) => solid.id as number);
    }

    const run = await runSidecarVmf<{
      solidIds: number[];
      newSolidId: number;
      pointCount: number;
      planeCount: number;
      keepSources: boolean;
      removedSourceCount: number;
      owner: string;
    }>({
      config: ctx.config,
      verb: "hull_solids",
      path,
      out,
      overwrite: args.overwrite ?? false,
      dryRun: args.dryRun,
      backup: args.backup,
      label: "hull",
      params: {
        solidIds: sourceIds,
        points: args.points ?? [],
        keepSources: args.keepSources ?? true,
        ...(args.material ? { material: args.material } : {}),
      },
      validate: (text, reply) => {
        const hull = checkVmfSolids(path, text).solids.find(
          (solid) => solid.id === reply.newSolidId,
        );
        if (!hull) {
          throw new Error(`the sidecar reported solid ${reply.newSolidId}, but it is not in the map`);
        }
        if (!hull.valid) {
          throw new Error(
            `the hull is not a valid brush: ` +
              hull.findings.map((finding) => finding.message).join(" | "),
          );
        }
      },
    });
    ctx.audit.record({
      kind: "file_write",
      data: { path: out, backup: run.write.backupPath, hullPoints: run.reply.pointCount },
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

export const hullTools = [hullSolidsTool];
