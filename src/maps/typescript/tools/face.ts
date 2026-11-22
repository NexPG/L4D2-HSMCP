import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { gameFor } from "../../../core/typescript/games/resolve.js";
import { alignFaces, normaliseMaterial, copyFaceAlignment, setFaceMaterial, setFaceUv, setSmoothingGroups } from "../vmf/face.js";
import type { AlignMode } from "../vmf/face.js";
import { FACE_SELECTOR_FIELDS, faceSelectorFrom } from "../vmf/select.js";
import { assertGeometryUntouched, checkVmfSolids } from "../vmf/solid.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, GAME, resolveVmfInput } from "../../../core/typescript/tools/paths.js";

/** Refuses to write when a face edit moved any geometry, which it never should. */

/** The algebra oracle: read_vmf_solids refuses axes no texture can use. */
function assertAxesAccepted(path: string, text: string): void {
  const after = checkVmfSolids(path, text);
  const bad = after.solids.filter((s) =>
    s.findings.some(
      (f) =>
        f.severity === "error" &&
        (f.rule === "texture-axis-along-normal" ||
          f.rule === "zero-texture-scale" ||
          f.rule === "degenerate-texture-axis"),
    ),
  );
  if (bad.length > 0) {
    throw new Error(
      `refusing to write: this alignment produced texture axes the checker rejects on ` +
        `${bad.length} solid(s). ` +
        bad
          .flatMap((s) => s.findings.filter((f) => f.severity === "error").map((f) => f.message))
          .join(" | "),
    );
  }
}

export const setFaceMaterialTool = defineTool({
  name: "set_face_material",
  description:
    "Sets the material on selected faces of a .vmf. Until this existed a brush's material " +
    "was fixed at creation and nothing could change it, which made set_lightmap_scale the " +
    "odd position of being able to say how finely to light a wall but not what the wall " +
    "was made of. Selects by solid, material, facing or area. The name is normalised to " +
    "the form a .vmf stores -- uppercase, no materials/ prefix, no .vmt suffix -- because " +
    "vbsp resolves it literally and a wrong one is invisible until a player loads the map. " +
    "Whether the material exists is NOT checked here: use read_game_content for that.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    newMaterial: z.string().describe("Material to apply, in any of the usual forms."),
    ...FACE_SELECTOR_FIELDS,
    all: z
      .boolean()
      .optional()
      .describe("Every face of the map. Required when no other criterion is given."),
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
    changed: z.array(
      z.object({
        solidId: z.number(),
        sideId: z.number().nullable(),
        from: z.string(),
        to: z.string(),
      }),
    ),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = setFaceMaterial(before, faceSelectorFrom(args), args.newMaterial);
    assertGeometryUntouched(path, before, result.text, "a face edit");

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
      changed: result.changed,
      warnings: result.warnings,
      nextStep:
        "Nothing here proved the material exists. Compile and run read_map_dependencies: a " +
        "name that resolves to nothing is a purple checkerboard for the player and silence " +
        "for everyone else.",
    };
  },
});

export const alignFacesTool = defineTool({
  name: "align_faces",
  description:
    "Realigns the texture on selected faces: to the world axes, to the face's own plane, " +
    "or stretched to fit the face. Hammer's three alignment modes. 'world' derives the " +
    "axes from the face's dominant normal using vbsp's own base-axis table, which is what " +
    "a face gets at creation; 'face' projects them into the face's plane so the texture " +
    "runs along a slope instead of being squashed onto it; 'fit' spans the face exactly. " +
    "The offsets are always recomputed from a corner of the face rather than carried over " +
    "-- an axis pair with a stale offset puts the texture somewhere else entirely, which " +
    "is the most common way an alignment tool produces a map that compiles and looks wrong.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    mode: z
      .enum(["world", "face", "fit", "arc"])
      .describe(
        "'arc' is 'face' plus continuity: facets that touch without turning a corner are one " +
          "run, and each carries its texture on from where the last one stopped. It is what a " +
          "curve needs and what neither of the others gives -- a ring aligned to 'face' " +
          "restarts the brick at every seam, which reads as flat plates however well the " +
          "smoothing groups are set.",
      ),
    scale: z
      .number()
      .optional()
      .describe("Multiply both texture scales by this afterwards. Zero is refused."),
    rotate: z.number().optional().describe("Turn the axis pair in the face's plane, degrees."),
    shift: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe("Add to the u and v offsets, in texels."),
    repeat: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe("For 'fit': how many times the texture repeats across the face. Default once."),
    fitRect: z
      .object({
        mins: z.tuple([z.number(), z.number()]),
        maxs: z.tuple([z.number(), z.number()]),
      })
      .optional()
      .describe(
        "For 'fit': a sub-rectangle of the texture in pixels, as read_rect reports it. The " +
          "face is fitted to this hotspot instead of the whole texture; the origin is the " +
          "top-left and maxs must be below and right of mins.",
      ),
    ...FACE_SELECTOR_FIELDS,
    all: z
      .boolean()
      .optional()
      .describe("Every face of the map. Required when no other criterion is given."),
    game: GAME,
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
    changed: z.array(
      z.object({
        solidId: z.number(),
        sideId: z.number().nullable(),
        material: z.string(),
        uaxis: z.string(),
        vaxis: z.string(),
      }),
    ),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    if (args.repeat && (args.repeat[0] <= 0 || args.repeat[1] <= 0)) {
      throw new Error(
        `fit needs a positive number of repeats on both axes, not ${args.repeat.join(" and ")}`,
      );
    }
    if (args.fitRect && args.mode !== "fit") {
      throw new Error(
        `fitRect is only meaningful with mode 'fit'; mode '${args.mode}' derives the axes ` +
          `from the face and would ignore the hotspot`,
      );
    }
    // Hammer's Fit reads the texture's real size from the VTF. The offline path asks the
    // sidecar for it; a lookup that fails leaves the 512 assumption and its warning.
    let textureSizes: Map<string, [number, number]> | undefined;
    if (args.mode === "fit" && !args.fitRect) {
      const { game } = gameFor(ctx.config, args.game);
      if (game.gameDir) {
        const materials = new Set<string>();
        for (const match of before.matchAll(/"material"\s+"([^"]+)"/g)) {
          materials.add(normaliseMaterial(match[1]!));
          if (materials.size >= 32) break;
        }
        const sizes = new Map<string, [number, number]>();
        for (const material of materials) {
          try {
            const info = (await callSidecar(
              "material_preview",
              { gameDir: game.gameDir, material, maxSize: 32 },
              ctx.config,
              60_000,
            )) as { width?: number; height?: number };
            if (
              typeof info.width === "number" &&
              typeof info.height === "number" &&
              info.width > 0 &&
              info.height > 0
            ) {
              sizes.set(material, [info.width, info.height]);
            }
          } catch {
            // A missing texture is a missing size, not a failed alignment.
          }
        }
        if (sizes.size > 0) textureSizes = sizes;
      }
    }
    const result = alignFaces(before, faceSelectorFrom(args), {
      mode: args.mode as AlignMode,
      ...(textureSizes ? { textureSizes } : {}),
      ...(args.scale !== undefined ? { scale: args.scale } : {}),
      ...(args.rotate !== undefined ? { rotate: args.rotate } : {}),
      ...(args.shift !== undefined ? { shift: args.shift as [number, number] } : {}),
      ...(args.repeat !== undefined ? { repeat: args.repeat as [number, number] } : {}),
      ...(args.fitRect !== undefined
        ? { fitRect: args.fitRect as { mins: [number, number]; maxs: [number, number] } }
        : {}),
    });
    assertGeometryUntouched(path, before, result.text, "a face edit");

    // The algebra oracle, run before the file is touched: read_vmf_solids already refuses
    // a texture axis lying along the face normal, a zero scale and a degenerate pair. An
    // alignment that produced any of those would compile and look wrong, silently.
    assertAxesAccepted(path, result.text);

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
      changed: result.changed,
      warnings: result.warnings,
      nextStep:
        "Alignment is one of the things no offline check can judge. The axes are legal and " +
        "the offsets start at the face's edge; whether it looks right is for the eye.",
    };
  },
});

export const setFaceUvTool = defineTool({
  name: "set_face_uv",
  description:
    "Writes a face's texture axes directly: the U and V vectors, their offsets and scales, " +
    "and the `rotation` key. Hammer's face sheet exposes the same numbers; align_faces " +
    "derives them from a mode, which cannot make a deliberately skewed pair. An omitted " +
    "vector keeps the face's current one, so changing only the shift or scale is one call. " +
    "The result is checked as a face before the write: an axis along the normal, a zero " +
    "scale or a degenerate pair is refused. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    uaxis: z.tuple([z.number(), z.number(), z.number()]).optional().describe("Texture U vector."),
    vaxis: z.tuple([z.number(), z.number(), z.number()]).optional().describe("Texture V vector."),
    uShift: z.number().optional().describe("U offset in texels."),
    vShift: z.number().optional().describe("V offset in texels."),
    uScale: z.number().optional().describe("U scale; zero is refused."),
    vScale: z.number().optional().describe("V scale; zero is refused."),
    rotation: z.number().optional().describe("The side's `rotation` key, in degrees."),
    ...FACE_SELECTOR_FIELDS,
    all: z
      .boolean()
      .optional()
      .describe("Every face of the map. Required when no other criterion is given."),
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
    changed: z.array(
      z.object({
        solidId: z.number(),
        sideId: z.number().nullable(),
        uaxis: z.string(),
        vaxis: z.string(),
        rotation: z.number().nullable(),
      }),
    ),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = setFaceUv(before, faceSelectorFrom(args), {
      ...(args.uaxis !== undefined ? { uaxis: args.uaxis as [number, number, number] } : {}),
      ...(args.vaxis !== undefined ? { vaxis: args.vaxis as [number, number, number] } : {}),
      ...(args.uShift !== undefined ? { uShift: args.uShift } : {}),
      ...(args.vShift !== undefined ? { vShift: args.vShift } : {}),
      ...(args.uScale !== undefined ? { uScale: args.uScale } : {}),
      ...(args.vScale !== undefined ? { vScale: args.vScale } : {}),
      ...(args.rotation !== undefined ? { rotation: args.rotation } : {}),
    });
    assertGeometryUntouched(path, before, result.text, "a face edit");
    assertAxesAccepted(path, result.text);

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
      changed: result.changed,
      warnings: result.warnings,
      nextStep:
        "Compile and look at the surface. The axes are legal and the geometry did not move; " +
        "whether the skew reads as intended is for the eye.",
    };
  },
});

export const copyFaceAlignmentTool = defineTool({
  name: "copy_face_alignment",
  description:
    "Copies ONE face's exact texture alignment -- uaxis, vaxis, offset and scale -- onto " +
    "other faces, the operation Hammer calls copy/paste alignment. The axes are copied as " +
    "stored, not recomputed from each target's normal, so brick carries on from the same " +
    "place across two walls instead of restarting at every face. Optionally copies the " +
    "material and an explicit lightmap scale. On a face pointing a different way the exact " +
    "axes are legal but may stretch; the tool says which faces those are, and refuses axes " +
    "the reader rejects. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    sourceSolidId: z.number().describe("Hammer id of the face's solid, from read_vmf."),
    sourceSideId: z.number().describe("The side id to copy from, from read_vmf."),
    copyMaterial: z
      .boolean()
      .optional()
      .describe("Also copy the source face's material. Off by default: alignment only."),
    copyLightmapScale: z
      .boolean()
      .optional()
      .describe("Also copy an explicit lightmapscale. Off by default."),
    ...FACE_SELECTOR_FIELDS,
    all: z
      .boolean()
      .optional()
      .describe("Every face of the map. Required when no other criterion is given."),
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
    changed: z.array(
      z.object({
        solidId: z.number(),
        sideId: z.number().nullable(),
        field: z.enum(["material", "uaxis", "vaxis", "lightmapscale"]),
        from: z.string().nullable(),
        to: z.string(),
      }),
    ),
    source: z.object({
      solidId: z.number(),
      sideId: z.number().nullable(),
      material: z.string(),
      uaxis: z.string(),
      vaxis: z.string(),
      lightmapScale: z.number().nullable(),
    }),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = copyFaceAlignment(
      before,
      args.sourceSolidId,
      args.sourceSideId,
      faceSelectorFrom(args),
      {
        ...(args.copyMaterial !== undefined ? { copyMaterial: args.copyMaterial } : {}),
        ...(args.copyLightmapScale !== undefined
          ? { copyLightmapScale: args.copyLightmapScale }
          : {}),
      },
    );
    assertGeometryUntouched(path, before, result.text, "a face edit");
    assertAxesAccepted(path, result.text);

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
      changed: result.changed,
      source: result.source,
      warnings: result.warnings,
      nextStep:
        "Exact alignment on a face pointing another way is legal and may still look " +
        "squashed. Compile and look; for a curve, align_faces mode 'arc' is the tool that " +
        "carries the texture around the turn instead of copying one flat pair everywhere.",
    };
  },
});

export const setSmoothingGroupsTool = defineTool({
  name: "set_smoothing_groups",
  description:
    "Sets the smoothing groups on selected faces. Two faces sharing an edge and a group " +
    "are lit by vrad as one continuous surface; without it every facet of a curve is lit " +
    "separately and reads as the flat polygons it really is. Takes Hammer's own group " +
    "numbers, 1 to 32, and does the bit shifting -- the file stores a bitmask, so group 13 " +
    "is 4096 and getting that wrong is silent. Pass an empty list to clear them.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    groups: z
      .array(z.number().int().min(1).max(32))
      .describe("Hammer's group numbers, 1 to 32. Empty clears every group."),
    ...FACE_SELECTOR_FIELDS,
    all: z
      .boolean()
      .optional()
      .describe("Every face of the map. Required when no other criterion is given."),
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
    facesChanged: z.number(),
    /** The bitmask as the file stores it, so the caller can check it against Hammer. */
    mask: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = setSmoothingGroups(before, faceSelectorFrom(args), args.groups);
    assertGeometryUntouched(path, before, result.text, "a face edit");

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
      facesChanged: result.changed.length,
      mask: result.groups,
      warnings: result.warnings,
      nextStep:
        "Smoothing only shows after vrad. Compile with lighting and look: nothing in the " +
        "file, and no measurement here, distinguishes a curve that reads as smooth from " +
        "one that reads as facets.",
    };
  },
});

export const faceTools = [
  setFaceMaterialTool,
  alignFacesTool,
  setFaceUvTool,
  copyFaceAlignmentTool,
  setSmoothingGroupsTool,
];
