import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { readDisplacements } from "../vmf/displacement.js";
import {
  paintDisplacements,
  sculptDisplacements,
  sewDisplacements,
  subdivideDisplacements,
  writeDisplacements,
} from "../vmf/dispwrite.js";
import { checkSeal, SEAL_MATERIAL, sealDisplacements } from "../vmf/dispseal.js";
import type { FaceSelector } from "../vmf/select.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveVmfInput } from "../../../core/typescript/tools/paths.js";

const faceSelectorFrom = (args: {
  solidIds?: number[];
  material?: string;
  facing?: "up" | "down" | "side" | "any";
  minArea?: number;
  all?: boolean;
}): FaceSelector => {
  // The same guard the face tools carry, and it was missing here -- on the one tool that
  // rewrites every eligible face of the map. An empty material is refused for the same
  // reason: the key being present satisfied the guard while matchesFace treated "" as
  // falsy and matched everything.
  if (args.material !== undefined && args.material.trim().length === 0) {
    throw new Error(
      "material is empty, which matches every face rather than none. Give a name, or pass " +
        "all:true if displacing the whole map is what was meant.",
    );
  }
  const sel: FaceSelector = {
    ...(args.solidIds !== undefined ? { solidIds: args.solidIds } : {}),
    ...(args.material !== undefined ? { material: args.material } : {}),
    ...(args.facing !== undefined ? { facing: args.facing } : {}),
    ...(args.minArea !== undefined ? { minArea: args.minArea } : {}),
  };
  if (Object.keys(sel).length === 0 && args.all !== true) {
    throw new Error(
      "this would put a displacement on every quadrilateral face in the map. Name solidIds, " +
        "a material, a facing or a minArea, or pass all:true to say you meant it.",
    );
  }
  return sel;
};

/** Refuses to write when a displacement edit moved a brush, which it never should. */
function assertGeometryUntouched(path: string, before: string, after: string): void {
  const b = checkVmfSolids(path, before);
  const a = checkVmfSolids(path, after);
  if (a.solidCount !== b.solidCount) {
    throw new Error(
      `refusing to write: a displacement edit changed the solid count from ${b.solidCount} ` +
        `to ${a.solidCount}. A displacement is drawn over a face; it does not move one.`,
    );
  }
  for (const x of b.solids) {
    if (x.id === null) continue;
    const y = a.solids.find((s) => s.id === x.id);
    if (!y || y.volume !== x.volume) {
      throw new Error(`refusing to write: solid ${x.id} changed shape. It never should.`);
    }
  }
}

const Vec = z.tuple([z.number(), z.number(), z.number()]);

export const readDisplacementsTool = defineTool({
  name: "read_displacements",
  description:
    "Reads the displacements of a .vmf: the grids of vertices that replace a brush face " +
    "and make every piece of terrain in Source. Until now this toolkit could only detect " +
    "one -- read_vmf_solids has reported hasDisplacement since the beginning and nothing " +
    "has ever read what was in it. Reports each grid's power and size, where it starts, " +
    "how far the terrain moves, how much of it is painted, and the world position of every " +
    "vertex. Positions rather than raw arrays, because every question worth asking about a " +
    "displacement is a question about where its vertices are. Also finds seams: two " +
    "vertices that share an undisplaced point and no longer share a displaced one, which " +
    "is the crack a player falls through and which is invisible in the editor.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    includeVertices: z
      .boolean()
      .optional()
      .describe(
        "Return every vertex. Off by default: a power-4 displacement has 289 of them and " +
          "a hillside has dozens of displacements.",
      ),
  },
  outputSchema: {
    path: z.string(),
    count: z.number(),
    displacements: z.array(
      z.object({
        solidId: z.number(),
        owner: z.string(),
        sideIndex: z.number(),
        sideId: z.number().nullable(),
        material: z.string(),
        power: z.number(),
        /** 2^power + 1: the grid is this on a side. */
        size: z.number(),
        startPosition: Vec,
        elevation: z.number(),
        subdiv: z.boolean(),
        corners: z.array(Vec),
        minDistance: z.number(),
        maxDistance: z.number(),
        alphaPainted: z.number(),
        minAlpha: z.number(),
        maxAlpha: z.number(),
        vertices: z
          .array(z.object({ x: z.number(), y: z.number(), position: Vec, alpha: z.number() }))
          .optional(),
        findings: z.array(z.string()),
      }),
    ),
    /** Pairs that share a flat point and not a displaced one. */
    seams: z.array(
      z.object({
        between: z.array(z.number()),
        worstGap: z.number(),
        openPairs: z.number(),
      }),
    ),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const r = readDisplacements(readFileSync(path, "utf8"));
    return {
      path,
      count: r.displacements.length,
      displacements: r.displacements.map((d) => ({
        solidId: d.solidId,
        owner: d.owner,
        sideIndex: d.sideIndex,
        sideId: d.sideId,
        material: d.material,
        power: d.power,
        size: d.size,
        startPosition: d.startPosition as unknown as [number, number, number],
        elevation: d.elevation,
        subdiv: d.subdiv,
        corners: d.corners as unknown as Array<[number, number, number]>,
        minDistance: d.minDistance,
        maxDistance: d.maxDistance,
        alphaPainted: d.alphaPainted,
        minAlpha: d.minAlpha,
        maxAlpha: d.maxAlpha,
        ...(args.includeVertices === true
          ? {
              vertices: d.vertices.map((v) => ({
                x: v.x,
                y: v.y,
                position: v.position as unknown as [number, number, number],
                alpha: v.alpha,
              })),
            }
          : {}),
        findings: d.findings,
      })),
      seams: r.seams.map((s) => ({
        between: s.between as unknown as number[],
        worstGap: s.worstGap,
        openPairs: s.openPairs,
      })),
      warnings: r.warnings,
      nextStep:
        "A seam is measured here and only the eye judges the terrain. Nothing offline says " +
        "whether a hillside looks like one.",
    };
  },
});



const FACE_SELECTOR = {
  solidIds: z.array(z.number()).optional(),
  material: z.string().optional().describe("Faces carrying this. Substring, case-insensitive."),
  facing: z.enum(["up", "down", "side", "any"]).optional(),
  minArea: z.number().optional(),
};

export const writeDisplacementTool = defineTool({
  name: "write_displacement",
  description:
    "Creates displacements on selected faces: the vertex grids that make every piece of " +
    "terrain in Source. Power 2, 3 or 4, which are 5x5, 9x9 and 17x17 grids -- Source " +
    "accepts 0 and 1 and no terrain is built with them. Flat by default, which is what " +
    "Hammer's own create makes and what a mapper then sculpts. WARNING: a displacement does " +
    "not seal. vbsp takes a displaced brush out of the hull and draws its surface separately, " +
    "so the inside of that brush is void and a displaced floor leaks through a shape that " +
    "looks solid in the editor. Pass seal:true to duplicate each displaced brush as a " +
    "tool-textured solid in the same write; seal_displacements does it afterwards. Refuses a " +
    "face that already carries one rather than discarding what was sculpted onto it.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    power: z.number().int().min(2).max(4).describe("2, 3 or 4: a 5x5, 9x9 or 17x17 grid."),
    ...FACE_SELECTOR,
    all: z
      .boolean()
      .optional()
      .describe("Every quadrilateral face of the map. Required when nothing else narrows it."),
    seal: z
      .boolean()
      .optional()
      .describe(
        "Duplicate each displaced brush as a tool-textured solid in the same write. A " +
          "displacement does not seal -- vbsp drops a displaced brush from the hull -- so a " +
          "displaced floor leaks. This is the repair, and it is what a mapper does by hand.",
      ),
    sealMaterial: z
      .string()
      .optional()
      .describe(`Material for the sealing duplicate. Default ${SEAL_MATERIAL}.`),
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
    created: z.array(
      z.object({ solidId: z.number(), power: z.number(), vertices: z.number() }),
    ),
    sealed: z
      .array(z.object({ solidId: z.number(), sealId: z.number(), faces: z.number() }))
      .optional(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = writeDisplacements(before, faceSelectorFrom(args), { power: args.power });
    assertGeometryUntouched(path, before, result.text);

    // The oracle: the reader has to find every grid this wrote, at the size it claims.
    const back = readDisplacements(result.text).displacements;
    for (const made of result.created) {
      const found = back.find((d) => d.solidId === made.solidId);
      if (!found || found.vertices.length !== made.vertices) {
        throw new Error(
          `refusing to write: the displacement on solid ${made.solidId} does not read back ` +
            `as the ${made.vertices}-vertex grid it was written as`,
        );
      }
      if (found.findings.length > 0) {
        throw new Error(`refusing to write: ${found.findings.join(" | ")}`);
      }
    }

    let text = result.text;
    let sealed: Array<{ solidId: number; sealId: number; faces: number }> | undefined;
    if (args.seal === true) {
      const repair = sealDisplacements(text, {
        solidIds: result.created.map((c) => c.solidId),
        ...(args.sealMaterial !== undefined ? { material: args.sealMaterial } : {}),
      });
      const problems = checkSeal(text, repair.text);
      if (problems.length > 0) throw new Error(`refusing to write: ${problems.join(" | ")}`);
      text = repair.text;
      sealed = repair.sealed;
    }

    const write = writeGuarded(path, text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: text === before,
    });
    const world = readDisplacements(text).warnings;
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: text === before,
      matched: result.matched,
      created: result.created.map((c) => ({
        solidId: c.solidId,
        power: c.power,
        vertices: c.vertices,
      })),
      ...(sealed !== undefined ? { sealed } : {}),
      warnings: [...result.warnings, ...world],
      nextStep:
        sealed !== undefined
          ? "Compile and read_leak. The seal is a duplicate of each displaced brush with a " +
            "tool material; terrain sculpted below the original face will meet it."
          : "Compile and read_leak if any of these brushes was part of the hull. A displaced " +
            "brush does not seal, and the leak will name a brush that looks solid. " +
            "seal_displacements adds the duplicate that fixes it.",
    };
  },
});

export const sewDisplacementsTool = defineTool({
  name: "sew_displacements",
  description:
    "Pulls displacements back together along the edges they share. Two vertices belong " +
    "together when their undisplaced positions coincide -- the faces share that point " +
    "whatever either grid has since done to it -- and each group is moved to its average, " +
    "which is what Hammer's Sew does and what keeps a ridge from being dragged to one side " +
    "of the join. The check is exact: read_displacements must report no seam afterwards, " +
    "and it decides adjacency the same way, so it would find any pair this missed.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    tolerance: z
      .number()
      .positive()
      .optional()
      .describe(
        "How close two flat points must be to count as the same one. Default 0.1. Must be " +
          "positive: zero would group every vertex of the map into one.",
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
    verticesMoved: z.number(),
    worstGapBefore: z.number(),
    worstGapAfter: z.number(),
    seamsAfter: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = sewDisplacements(before, args.tolerance ?? 0.1);
    assertGeometryUntouched(path, before, result.text);

    const after = readDisplacements(result.text);
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
      verticesMoved: result.moved,
      worstGapBefore: result.worstBefore,
      worstGapAfter: result.worstAfter,
      seamsAfter: after.seams.length,
      warnings: result.warnings,
      nextStep:
        after.seams.length === 0
          ? "No seam is left. Whether the terrain looks right is still for the eye."
          : "Seams remain: two grids of different power, or normals that disagree. Neither " +
            "is something averaging can fix.",
    };
  },
});

export const sculptDisplacementTool = defineTool({
  name: "sculpt_displacement",
  description:
    "Reshapes displacements: flatten, raise, slope between two heights, or add noise. " +
    "Declarative shapes rather than a table of vertices, and noise takes a seed rather " +
    "than reaching for a random number generator -- a terrain that cannot be regenerated " +
    "from what produced it cannot be reviewed, cannot be tested and cannot survive a merge. " +
    "Sculpting one displacement of a terrain moves the edge it shares with its neighbours, " +
    "so the result says whether a seam opened and sew_displacements closes it.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidIds: z.array(z.number()).optional().describe("Displacements on these brushes."),
    shape: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("flatten") }),
      z.object({ kind: z.literal("raise"), by: z.number() }),
      z.object({
        kind: z.literal("slope"),
        from: z.number(),
        to: z.number(),
        along: z.enum(["x", "y"]),
      }),
      z.object({
        kind: z.literal("noise"),
        amplitude: z.number(),
        seed: z.number().int().describe("Same seed, same terrain, every time."),
      }),
    ]),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    verticesMoved: z.number(),
    minDistance: z.number(),
    maxDistance: z.number(),
    seamsAfter: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = sculptDisplacements(
      before,
      args.solidIds ? { solidIds: args.solidIds } : {},
      args.shape as never,
    );
    assertGeometryUntouched(path, before, result.text);

    const after = readDisplacements(result.text);
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
      verticesMoved: result.moved,
      minDistance: result.minDistance,
      maxDistance: result.maxDistance,
      seamsAfter: after.seams.length,
      warnings: result.warnings,
      nextStep:
        after.seams.length > 0
          ? "Run sew_displacements: this opened the join with the neighbouring terrain."
          : "Nothing offline says whether a hillside looks like one. That part is the eye's.",
    };
  },
});

export const paintDisplacementTool = defineTool({
  name: "paint_displacement",
  description:
    "Paints the blend channel of displacements: uniform, by height, or by slope. A blend " +
    "material draws its second texture where alpha is 255 and its first where it is zero, " +
    "which is how a gravel path appears through grass. By height fades between two " +
    "elevations rather than stepping, because a shoreline that changes in one vertex is " +
    "not what anyone wants. Says so when the material has no blend in its name: alpha does " +
    "nothing on a material that is not a blend shader, and vbsp does not mention it.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidIds: z.array(z.number()).optional(),
    rule: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("uniform"), alpha: z.number().min(0).max(255) }),
      z.object({
        kind: z.literal("byHeight"),
        low: z.number().describe("Fully the first texture at or below this z."),
        high: z.number().describe("Fully the second at or above it."),
      }),
      z.object({
        kind: z.literal("bySlope"),
        degrees: z.number().describe("Anything steeper than this takes the second texture."),
      }),
    ]),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    verticesPainted: z.number(),
    minAlpha: z.number(),
    maxAlpha: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = paintDisplacements(
      before,
      args.solidIds ? { solidIds: args.solidIds } : {},
      args.rule as never,
    );
    assertGeometryUntouched(path, before, result.text);

    // Painting must not move anything: the shape and the blend are different channels.
    const was = readDisplacements(before).displacements;
    for (const d of readDisplacements(result.text).displacements) {
      const old = was.find((x) => x.solidId === d.solidId && x.sideIndex === d.sideIndex);
      if (old && (old.minDistance !== d.minDistance || old.maxDistance !== d.maxDistance)) {
        throw new Error(
          `refusing to write: painting solid ${d.solidId} changed its shape. It never should.`,
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
      verticesPainted: result.painted,
      minAlpha: result.minAlpha,
      maxAlpha: result.maxAlpha,
      warnings: result.warnings,
      nextStep:
        "Compile with lighting and look. A blend is one of the things no offline check can " +
        "judge: the numbers are right or wrong, the boundary is beautiful or it is not.",
    };
  },
});

export const subdivideDisplacementsTool = defineTool({
  name: "subdivide_displacements",
  description:
    "Hammer's Subdivide: raises a displacement's power from 2 or 3 to 3 or 4 while keeping " +
    "its shape. The new grid samples the old one bilinearly, so the silhouette is preserved " +
    "and there are four times as many vertices to sculpt; alpha is rounded and normals are " +
    "renormalised, and a non-walkable triangle tag stays non-walkable. Warns that a seam " +
    "whose neighbour was not subdivided can crack, and reads the result back to prove the " +
    "power and vertex count. Selects by solid id, side id or material; an empty selector is " +
    "refused unless all:true. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    power: z.number().int().min(3).max(4).describe("The new power: 3 or 4."),
    solidIds: z.array(z.number()).optional().describe("Only displacements on these solids."),
    sideIds: z
      .array(z.number())
      .optional()
      .describe("Only these side ids, for one exact face."),
    material: z
      .string()
      .optional()
      .describe("Only displacements carrying this material. Substring, case-insensitive."),
    all: z
      .boolean()
      .optional()
      .describe("Required to subdivide every displacement in the map."),
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
    subdivided: z.array(
      z.object({
        solidId: z.number(),
        sideIndex: z.number(),
        fromPower: z.number(),
        toPower: z.number(),
        vertices: z.number(),
      }),
    ),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = subdivideDisplacements(
      before,
      {
        ...(args.solidIds !== undefined ? { solidIds: args.solidIds } : {}),
        ...(args.sideIds !== undefined ? { sideIds: args.sideIds } : {}),
        ...(args.material !== undefined ? { material: args.material } : {}),
        ...(args.all !== undefined ? { all: args.all } : {}),
      },
      args.power,
    );

    const b = checkVmfSolids(path, before);
    const a = checkVmfSolids(path, result.text);
    if (a.solidCount !== b.solidCount) {
      throw new Error("refusing to write: subdividing a displacement changed the brush count");
    }
    for (const x of b.solids) {
      if (x.id === null) continue;
      const y = a.solids.find((s) => s.id === x.id);
      if (!y || y.volume !== x.volume) {
        throw new Error(
          `refusing to write: solid ${x.id} changed shape during a displacement edit. ` +
            `Only the dispinfo block may change.`,
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
      subdivided: result.subdivided,
      warnings: result.warnings,
      nextStep:
        "Compile with lighting and look at the terrain: the silhouette should be the same, " +
        "with more vertices to sculpt. If the displacement shares a seam with one that kept " +
        "its old power, run sew_displacements or subdivide the neighbour too.",
    };
  },
});

export const sealDisplacementsTool = defineTool({
  name: "seal_displacements",
  description:
    "Adds the solid a displacement removed: duplicates every displaced world brush, drops " +
    "its dispinfo and paints the copy with a tool material. A displacement does not seal, " +
    "and not merely because the surface moved -- vbsp takes the whole displaced brush out " +
    "of the hull, so a sealed room whose floor carries one leaks through the floor's own " +
    "volume. A plain duplicate closes it again; this is the operation Hammer++ calls a " +
    "sealing brush. Reads the result back and refuses a duplicate whose volume differs. " +
    "Leaves detail brushes alone (a detail brush never sealed the hull) and skips a brush " +
    "that already has an undisplaced twin, so a second run is a no-op. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidIds: z
      .array(z.number())
      .optional()
      .describe("Only seal these displaced brushes. Default: every displaced world brush."),
    material: z
      .string()
      .optional()
      .describe(`Material for the duplicate. Default ${SEAL_MATERIAL}.`),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    sealed: z.array(z.object({ solidId: z.number(), sealId: z.number(), faces: z.number() })),
    skipped: z.array(z.object({ solidId: z.number(), reason: z.string() })),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = sealDisplacements(before, {
      ...(args.solidIds !== undefined ? { solidIds: args.solidIds } : {}),
      ...(args.material !== undefined ? { material: args.material } : {}),
    });

    const problems = checkSeal(before, result.text);
    if (problems.length > 0) throw new Error(`refusing to write: ${problems.join(" | ")}`);

    // The seal has to be the same volume, carry no displacement, and be ordinary geometry.
    const after = checkVmfSolids(path, result.text);
    for (const made of result.sealed) {
      const source = after.solids.find((s) => s.id === made.solidId);
      const seal = after.solids.find((s) => s.id === made.sealId);
      if (!source || !seal) {
        throw new Error(`refusing to write: solid ${made.solidId} or its seal is not readable`);
      }
      if (Math.abs(seal.volume - source.volume) > 1e-3) {
        throw new Error(
          `refusing to write: the seal of solid ${made.solidId} has volume ${seal.volume} ` +
            `where the brush has ${source.volume}`,
        );
      }
      if (seal.sides.some((side) => side.hasDisplacement)) {
        throw new Error(`refusing to write: the seal of solid ${made.solidId} has a dispinfo`);
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
      sealed: result.sealed,
      skipped: result.skipped,
      warnings: result.warnings,
      nextStep:
        result.sealed.length > 0
          ? "Compile and read_leak. The duplicate sits exactly on the displaced brush's " +
            "volume; terrain edges should stay on the original face plane, which is where " +
            "the seal's surface is."
          : "Nothing was added. If read_leak still reports a leak, it names a brush this " +
            "map does not carry a displacement on.",
    };
  },
});

export const displacementTools = [
  readDisplacementsTool,
  writeDisplacementTool,
  subdivideDisplacementsTool,
  sewDisplacementsTool,
  sculptDisplacementTool,
  paintDisplacementTool,
  sealDisplacementsTool,
];
