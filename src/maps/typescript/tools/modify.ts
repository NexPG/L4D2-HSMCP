import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { cloneSolids } from "../vmf/clone.js";
import { deleteSolids, transformSolids } from "../vmf/modify.js";
import { matchesSolid } from "../vmf/select.js";
import type { SolidSelector } from "../vmf/select.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { IDENTITY, mirror, rotation, scaling, translation } from "../vmf/transform.js";
import type { Mat34 } from "../vmf/transform.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveVmfInput } from "../../../core/typescript/tools/paths.js";

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

const SELECTOR = {
  solidIds: z
    .array(z.number())
    .optional()
    .describe("Hammer ids, as read_vmf_solids reports them."),
  owner: z
    .string()
    .optional()
    .describe("'world', or a brush entity classname such as func_detail."),
  material: z
    .string()
    .optional()
    .describe("Brushes carrying this on at least one face. Substring, case-insensitive."),
  within: z
    .object({ mins: Vec3, maxs: Vec3 })
    .optional()
    .describe(
      "Brushes lying entirely inside this box. Entirely, not partly: a half-caught brush " +
        "is how a box selection catches something the caller could not see it had touched.",
    ),
};

const selectorFrom = (args: {
  solidIds?: number[];
  owner?: string;
  material?: string;
  within?: { mins: number[]; maxs: number[] };
}): SolidSelector => ({
  ...(args.solidIds !== undefined ? { ids: args.solidIds } : {}),
  ...(args.owner !== undefined ? { owner: args.owner } : {}),
  ...(args.material !== undefined ? { material: args.material } : {}),
  ...(args.within !== undefined
    ? {
        within: {
          mins: args.within.mins as [number, number, number],
          maxs: args.within.maxs as [number, number, number],
        },
      }
    : {}),
});

const TRANSFORM_FIELDS = {
  move: Vec3.optional().describe("Translate by this, in Hammer units."),
  rotate: z
    .object({
      axis: Vec3.describe("Axis to turn about. Need not be unit length."),
      degrees: z.number(),
      pivot: Vec3.optional().describe("Point to turn about. Default the selection's centre."),
    })
    .optional()
    .describe("Multiples of 90 are exact; other angles leave the brush off the grid, as Hammer does."),
  scale: z
    .object({
      factor: Vec3,
      pivot: Vec3.optional().describe("Default the selection's centre."),
    })
    .optional(),
  mirror: z
    .object({
      axis: z.enum(["x", "y", "z"]),
      pivot: Vec3.optional().describe("Default the selection's centre."),
    })
    .optional(),
  textureLock: z
    .boolean()
    .optional()
    .describe(
      "Default true: the texture stays put on its face. Refused on a scale that " +
        "stretches one axis more than another, because no texture axis pair can express " +
        "that -- pass false to accept the stretch.",
    ),
  grid: z
    .number()
    .optional()
    .describe(
      "Round every corner to this grid afterwards. Default 0, which rounds nothing. " +
        "Snapping is what makes a face stop being flat, so what it costs is measured and " +
        "reported as planarityError rather than assumed to be nothing.",
    ),
};

interface TransformInput {
  move?: number[] | undefined;
  rotate?: { axis: number[]; degrees: number; pivot?: number[] | undefined } | undefined;
  scale?: { factor: number[]; pivot?: number[] | undefined } | undefined;
  mirror?: { axis: "x" | "y" | "z"; pivot?: number[] | undefined } | undefined;
}

/**
 * The matrix for whichever single transform was asked for, around the selected centre.
 *
 * Shared by `transform_solids` and `clone_solids` so the two cannot drift on what a pivot
 * means. Exactly one of the four is allowed: two in one call hides which one produced the
 * result, and a caller who wants both can call twice.
 */
function matrixFrom(
  args: TransformInput,
  centre: () => [number, number, number],
  allowNone: boolean,
): Mat34 {
  const chosen = [args.move, args.rotate, args.scale, args.mirror].filter(
    (x) => x !== undefined,
  );
  if (allowNone && chosen.length === 0) return IDENTITY;
  if (chosen.length !== 1) {
    throw new Error(
      "give exactly one of move, rotate, scale or mirror. Combining them in one call " +
        "would hide which one produced the result; call twice instead.",
    );
  }
  if (args.move) return translation(args.move as [number, number, number]);
  if (args.rotate) {
    return rotation(
      args.rotate.axis as [number, number, number],
      args.rotate.degrees,
      (args.rotate.pivot as [number, number, number] | undefined) ?? centre(),
    );
  }
  if (args.scale) {
    return scaling(
      args.scale.factor as [number, number, number],
      (args.scale.pivot as [number, number, number] | undefined) ?? centre(),
    );
  }
  return mirror(
    args.mirror!.axis,
    (args.mirror!.pivot as [number, number, number] | undefined) ?? centre(),
  );
}

export const transformSolidsTool = defineTool({
  name: "transform_solids",
  description:
    "Moves, turns, scales or mirrors brushes that are already in a .vmf. Until this " +
    "existed the write path could only add: a brush placed an inch out of position could " +
    "not be nudged, only rewritten. Selects by id, owner, material or bounding box, and " +
    "edits only the plane and texture-axis lines of the brushes it moved -- nothing else " +
    "in the file shifts by a byte. Texture lock is on by default, so a texture stays where " +
    "it sits on its face, as in Hammer. The result is read back through read_vmf_solids " +
    "before the file is touched and the write is refused if any brush stopped being one; " +
    "volume is reported before and after, and a transform must scale it by its own " +
    "determinant or something is wrong.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    ...SELECTOR,
    ...TRANSFORM_FIELDS,
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    matched: z.number(),
    solids: z.array(
      z.object({
        id: z.number(),
        owner: z.string(),
        volumeBefore: z.number(),
        /** Measured from the result, not predicted: snapping is not an affine map. */
        volumeAfter: z.number(),
        /** What the determinant said it would be. A gap between the two is the snap. */
        volumePredicted: z.number(),
        minsAfter: Vec3,
        maxsAfter: Vec3,
      }),
    ),
    /** Worst distance from a corner to the plane its face claims. Zero unless grid was set. */
    planarityError: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");

    const selector = selectorFrom(args);
    const report = checkVmfSolids(path, before);
    // The whole selector, not half of it. Filtering on ids and owner only meant that a
    // rotation selected by material or by bounding box turned the narrower selection
    // around the centre of a wider one, which moves it as well as turning it.
    const chosenSolids = report.solids.filter((s) => matchesSolid(s, selector));
    const centre = (): [number, number, number] => {
      if (chosenSolids.length === 0) return [0, 0, 0];
      const mins = [0, 1, 2].map((a) => Math.min(...chosenSolids.map((s) => s.mins[a]!)));
      const maxs = [0, 1, 2].map((a) => Math.max(...chosenSolids.map((s) => s.maxs[a]!)));
      return [(mins[0]! + maxs[0]!) / 2, (mins[1]! + maxs[1]!) / 2, (mins[2]! + maxs[2]!) / 2];
    };

    const matrix = matrixFrom(args, centre, false);

    const result = transformSolids(before, selector, matrix, {
      ...(args.textureLock !== undefined ? { textureLock: args.textureLock } : {}),
      ...(args.grid !== undefined ? { grid: args.grid } : {}),
    });

    // The oracle, run before the file is touched. Two separate claims: every brush that
    // moved is still a brush, and no brush that did not move changed at all.
    const after = checkVmfSolids(path, result.text);
    if (after.solidCount !== report.solidCount) {
      throw new Error(
        `refusing to write: ${report.solidCount} solids went in and ${after.solidCount} ` +
          `came out. A transform never adds or removes one.`,
      );
    }
    const moved = new Set(result.solids.map((s) => s.id));
    const broken = after.solids.filter((s) => s.id !== null && moved.has(s.id) && !s.valid);
    if (broken.length > 0) {
      throw new Error(
        `refusing to write: ${broken.length} of the ${moved.size} brushes this would move ` +
          `stopped being valid brushes. ` +
          broken
            .flatMap((s) => s.findings.filter((f) => f.severity === "error").map((f) => f.message))
            .join(" | "),
      );
    }
    for (const b of report.solids) {
      if (b.id === null || moved.has(b.id)) continue;
      const a = after.solids.find((s) => s.id === b.id);
      if (!a || a.volume !== b.volume) {
        throw new Error(
          `refusing to write: solid ${b.id} was not selected and changed anyway. That is a ` +
            `bug in this tool, not in the map.`,
        );
      }
    }

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
      matched: result.matched,
      // Measured from the file this produced, not predicted from the determinant. Snapping
      // to a grid is not an affine map, so the prediction can be wrong by more than the
      // four decimals the plane points are written to -- and the reader has already been
      // run, so the real number was there for the asking.
      solids: result.solids.map((s) => {
        const measured = after.solids.find((x) => x.id === s.id);
        return {
          id: s.id,
          owner: s.owner,
          volumeBefore: s.volumeBefore,
          volumeAfter: measured?.volume ?? s.volumeAfter,
          volumePredicted: s.volumeAfter,
          minsAfter: (measured?.mins ?? s.minsAfter) as unknown as [number, number, number],
          maxsAfter: (measured?.maxs ?? s.maxsAfter) as unknown as [number, number, number],
        };
      }),
      planarityError: result.worstPlanarityError,
      warnings: result.warnings,
      nextStep:
        "Moving a brush that was part of the sealed hull can open the map. Compile and " +
        "read_leak: no check here can prove a hull still closes, because sealing is a " +
        "property of the whole map and not of any one brush.",
    };
  },
});

export const deleteSolidsTool = defineTool({
  name: "delete_solids",
  description:
    "Removes brushes from a .vmf. The counterpart of write_vmf_solid, and its absence is " +
    "what made every mistake permanent: a brush created in the wrong place could not be " +
    "taken back. Selects by id, owner, material or bounding box, refuses an empty selector " +
    "rather than emptying the map, and refuses brushes inside a hidden block, whose removal " +
    "would be as invisible as they are. Warns when the world is left with nothing to seal " +
    "with, and when a brush entity is left with no brushes at all. It cannot prove the map " +
    "still seals -- only a compile can.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    ...SELECTOR,
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    matched: z.number(),
    deleted: z.array(z.object({ id: z.number(), owner: z.string(), volume: z.number() })),
    solidsBefore: z.number(),
    solidsAfter: z.number(),
    /** World brushes left. Zero means nothing seals the map and the next compile leaks. */
    worldSolidsAfter: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const beforeReport = checkVmfSolids(path, before);

    const result = deleteSolids(before, selectorFrom(args));

    const afterReport = checkVmfSolids(path, result.text);
    const expected = beforeReport.solidCount - result.matched;
    if (afterReport.solidCount !== expected) {
      throw new Error(
        `refusing to write: removing ${result.matched} solids should leave ${expected}, and ` +
          `the result has ${afterReport.solidCount}. The cut took something it was not asked for.`,
      );
    }
    // Every survivor must be untouched. A line range that ran one character wide would
    // corrupt its neighbour, and the count above would not notice.
    const gone = new Set(result.deleted.map((d) => d.id));
    for (const b of beforeReport.solids) {
      if (b.id === null || gone.has(b.id)) continue;
      const a = afterReport.solids.find((s) => s.id === b.id);
      if (!a || a.volume !== b.volume || a.sides.length !== b.sides.length) {
        throw new Error(
          `refusing to write: solid ${b.id} was not selected and did not survive the cut ` +
            `unchanged. The removed range reached beyond the brush it named.`,
        );
      }
    }

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
      matched: result.matched,
      deleted: result.deleted,
      solidsBefore: beforeReport.solidCount,
      solidsAfter: afterReport.solidCount,
      worldSolidsAfter: result.worldSolidsAfter,
      warnings: result.warnings,
      nextStep:
        "Compile and read_leak. Deleting a world brush is the most direct way to open a " +
        "hull, and nothing offline can tell you whether this one was holding it.",
    };
  },
});

export const cloneSolidsTool = defineTool({
  name: "clone_solids",
  description:
    "Copies brushes that are already in a .vmf, giving every copy new solid and side ids " +
    "and keeping its materials, texture axes and smoothing groups byte for byte. Hammer's " +
    "Ctrl+C / Ctrl+V, and the missing half of the 3D skybox workflow: the sky camera needs " +
    "a scaled copy of geometry that must not belong to the playable map. Optionally applies " +
    "one move, rotation, scale or mirror to the copies. Refuses hidden and displaced brushes, " +
    "and every copy is checked as a solid before anything is written. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    ...SELECTOR,
    count: z
      .number()
      .int()
      .min(1)
      .max(256)
      .optional()
      .describe("How many copies of each selected brush. Default 1."),
    ...TRANSFORM_FIELDS,
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    matched: z.number(),
    clones: z.array(
      z.object({ sourceId: z.number(), newId: z.number(), owner: z.string() }),
    ),
    solidsBefore: z.number(),
    solidsAfter: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const selector = selectorFrom(args);
    const report = checkVmfSolids(path, before);
    const chosenSolids = report.solids.filter((s) => matchesSolid(s, selector));
    const centre = (): [number, number, number] => {
      if (chosenSolids.length === 0) return [0, 0, 0];
      const mins = [0, 1, 2].map((a) => Math.min(...chosenSolids.map((s) => s.mins[a]!)));
      const maxs = [0, 1, 2].map((a) => Math.max(...chosenSolids.map((s) => s.maxs[a]!)));
      return [(mins[0]! + maxs[0]!) / 2, (mins[1]! + maxs[1]!) / 2, (mins[2]! + maxs[2]!) / 2];
    };
    const matrix = matrixFrom(args, centre, true);

    const result = cloneSolids(before, selector, args.count ?? 1, matrix, {
      ...(args.textureLock !== undefined ? { textureLock: args.textureLock } : {}),
      ...(args.grid !== undefined ? { grid: args.grid } : {}),
    });

    if (result.clones.length === 0) {
      return {
        path,
        written: false,
        backupPath: null,
        unchanged: true,
        matched: 0,
        clones: [],
        solidsBefore: report.solidCount,
        solidsAfter: report.solidCount,
        warnings: result.warnings,
        nextStep: "Nothing matched. Check the selector with read_vmf_solids first.",
      };
    }

    const after = checkVmfSolids(path, result.text);
    if (after.solidCount !== report.solidCount + result.clones.length) {
      throw new Error(
        `refusing to write: ${report.solidCount} solids in, ${result.clones.length} copies, ` +
          `${after.solidCount} out`,
      );
    }

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
      matched: new Set(result.clones.map((c) => c.sourceId)).size,
      clones: result.clones,
      solidsBefore: report.solidCount,
      solidsAfter: after.solidCount,
      warnings: result.warnings,
      nextStep:
        "Copies keep their original owner, so a world brush stays world and a func_detail " +
        "brush stays detail. For a 3D skybox, scale the copies around the sky_camera origin " +
        "and seal the skybox area; a copy that overlaps the playable map is just z-fighting.",
    };
  },
});

export const modifyTools = [transformSolidsTool, cloneSolidsTool, deleteSolidsTool];
