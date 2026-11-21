/**
 * `read_model_ani`: the external `.ani` container a model's clips live in.
 *
 * A stock L4D2 survivor keeps its animation data in a sibling `.ani`. The `.mdl` holds only
 * the block table (`mstudioanimblock_t`: `dataStart`/`dataEnd` into the `.ani`) and each
 * animation descriptor's block index. This tool joins the two: the `.ani` header, every block
 * with its byte range, the clips and sequences that use it, and consistency checks (ranges
 * inside the file, no gaps or overlaps, no orphan blocks). `read_model_animation` reports the
 * descriptors; `decompile_model` decodes the frames.
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";
import {
  readAniHeader,
  readAnimBlocks,
  readAnimations,
  readSequences,
  sequenceAnimationIndices,
} from "../formats/mdlanim.js";
import type { MdlAnimationDesc, MdlSequence } from "../formats/mdlanim.js";
import { looseOrVpk, normalizeModelPath } from "./source.js";

/** `STUDIO_FRAMEANIM`: the frame-by-bone layout external clips use. */
const STUDIO_FRAMEANIM = 0x40;
/** `STUDIO_DELTA`: the clip stores deltas, not absolute local transforms. */
const STUDIO_DELTA = 0x10;

const BLOCK = z.object({
  index: z.number(),
  /** Byte offset in the `.ani`. */
  start: z.number(),
  end: z.number(),
  bytes: z.number(),
  empty: z.boolean(),
  /** External animations whose `animBlock` is this block. */
  animations: z.number(),
  frames: z.number(),
  seconds: z.number(),
  frameAnim: z.number(),
  sectioned: z.number(),
  delta: z.number(),
  sequenceCount: z.number(),
  /** Up to five sequence names, for identification. */
  sequences: z.array(z.string()),
  /** Up to three animation names, for identification. */
  animationNames: z.array(z.string()),
});

interface BlockStats {
  index: number;
  start: number;
  end: number;
  animations: number;
  frames: number;
  seconds: number;
  frameAnim: number;
  sectioned: number;
  delta: number;
  animationNames: string[];
}

interface SequenceUse {
  name: string;
  blocks: Set<number>;
}

function blockStats(animations: MdlAnimationDesc[], blockCount: number): Map<number, BlockStats> {
  const stats = new Map<number, BlockStats>();
  for (let index = 1; index < blockCount; index += 1) {
    stats.set(index, {
      index,
      start: 0,
      end: 0,
      animations: 0,
      frames: 0,
      seconds: 0,
      frameAnim: 0,
      sectioned: 0,
      delta: 0,
      animationNames: [],
    });
  }
  for (const animation of animations) {
    if (animation.animBlock <= 0) continue;
    const entry = stats.get(animation.animBlock);
    if (!entry) continue;
    entry.animations += 1;
    entry.frames += animation.frameCount;
    entry.seconds += animation.frameCount / (animation.fps > 0 ? animation.fps : 30);
    if ((animation.flags & STUDIO_FRAMEANIM) !== 0) entry.frameAnim += 1;
    if (animation.sectionFrameCount > 0) entry.sectioned += 1;
    if ((animation.flags & STUDIO_DELTA) !== 0) entry.delta += 1;
    if (entry.animationNames.length < 3) entry.animationNames.push(animation.name);
  }
  return stats;
}

function sequenceUses(
  mdl: Buffer,
  sequences: MdlSequence[],
  animations: MdlAnimationDesc[],
): SequenceUse[] {
  return sequences.map((sequence) => {
    const blocks = new Set<number>();
    for (const animationIndex of sequenceAnimationIndices(mdl, sequence)) {
      const block = animations[animationIndex]?.animBlock ?? 0;
      if (block > 0) blocks.add(block);
    }
    return { name: sequence.name, blocks };
  });
}

export const readModelAniTool = defineTool({
  name: "read_model_ani",
  description:
    "Reads the external `.ani` a model's clips live in: the `IDAG` header and version, every " +
    "anim block with its byte range and size, the clips and sequences that use each block, " +
    "frame-by-bone/sectioned/delta counts and the duration, plus range, gap, overlap and orphan " +
    "checks. Reports `present: false` with a note for a model whose animation data is inside " +
    "the `.mdl`. `read_model_animation` reports descriptors and `decompile_model` decodes frames.",
  realm: "map",
  inputSchema: {
    model: z
      .string()
      .optional()
      .describe("Engine model path; the models/ prefix and .mdl suffix are added if missing."),
    path: z
      .string()
      .optional()
      .describe("Local .mdl path, absolute or relative to the repo root."),
    block: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Only report this anim block index."),
    sequence: z
      .string()
      .optional()
      .describe("Only report blocks used by sequences whose name contains this text."),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    path: z.string().nullable(),
    model: z.string().nullable(),
    present: z.boolean(),
    aniPath: z.string(),
    size: z.number(),
    magic: z.string().nullable(),
    version: z.number().nullable(),
    blockCount: z.number(),
    nonEmptyBlocks: z.number(),
    /** Bytes before the first block (the `.ani` header area); 0 when there are no blocks. */
    headerBytes: z.number(),
    animationCount: z.number(),
    externalAnimations: z.number(),
    internalAnimations: z.number(),
    externalFrames: z.number(),
    externalSeconds: z.number(),
    returned: z.number(),
    blocks: z.array(BLOCK),
    warnings: z.array(z.string()),
    note: z.string().optional(),
  },
  handler: (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    let path: string | null = null;
    let model: string | null = null;
    let mdlBytes: Buffer | null = null;
    let aniPath = "";
    let aniBytes: Buffer | null = null;

    if (args.path) {
      path = resolveInput(args.path, ctx.config);
      if (extname(path).toLowerCase() === ".ani") {
        aniPath = path;
        aniBytes = existsSync(path) ? readFileSync(path) : null;
        const mdlPath = path.replace(/\.ani$/i, ".mdl");
        mdlBytes = existsSync(mdlPath)
          ? readFileSync(mdlPath)
          : ctx.config.gameDir
            ? looseOrVpk(ctx.config.gameDir, mdlPath)
            : null;
        if (!mdlBytes) throw new Error(`${mdlPath} was not found next to ${path}`);
        path = mdlPath;
      } else {
        if (extname(path).toLowerCase() !== ".mdl") throw new Error("`path` must be a .mdl or .ani");
        mdlBytes = existsSync(path) ? readFileSync(path) : null;
        const sibling = path.replace(/\.mdl$/i, ".ani");
        aniPath = sibling;
        aniBytes = existsSync(sibling) ? readFileSync(sibling) : null;
        if (!mdlBytes && ctx.config.gameDir) mdlBytes = looseOrVpk(ctx.config.gameDir, path);
        if (!mdlBytes) throw new Error(`${path} was not found`);
      }
    } else if (args.model) {
      if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
      model = normalizeModelPath(args.model);
      path = model;
      mdlBytes = looseOrVpk(game.gameDir, model);
      if (!mdlBytes) throw new Error(`${model} was not found in the game directory or its VPK`);
      aniPath = model.replace(/\.mdl$/i, ".ani");
      const loose = join(game.gameDir, aniPath);
      aniBytes = existsSync(loose) ? readFileSync(loose) : looseOrVpk(game.gameDir, aniPath);
    } else {
      throw new Error("give `model` (engine path) or `path` (local .mdl)");
    }

    const animations = readAnimations(mdlBytes);
    const sequences = readSequences(mdlBytes, animations);
    const table = readAnimBlocks(mdlBytes);
    const external = animations.filter((animation) => animation.animBlock !== 0);
    const internal = animations.length - external.length;
    const externalFrames = external.reduce((sum, animation) => sum + animation.frameCount, 0);
    const externalSeconds = external.reduce(
      (sum, animation) => sum + animation.frameCount / (animation.fps > 0 ? animation.fps : 30),
      0,
    );

    const warnings: string[] = [];
    let header: ReturnType<typeof readAniHeader> = null;
    if (!aniBytes) {
      if (external.length > 0) {
        warnings.push(
          `${external.length} of ${animations.length} animations need ${aniPath}, which is not ` +
            "installed; only their descriptors can be read and decompile writes no frames for them.",
        );
      }
    } else {
      header = readAniHeader(aniBytes);
      if (!header || header.magic !== "IDAG") {
        warnings.push(`${aniPath} does not start with the IDAG magic; block offsets may be wrong.`);
      }
    }

    const stats = blockStats(animations, table.length);
    const uses = sequenceUses(mdlBytes, sequences, animations);
    const sequenceNames = new Map<number, string[]>();
    const sequenceCounts = new Map<number, number>();
    for (const use of uses) {
      for (const block of use.blocks) {
        sequenceCounts.set(block, (sequenceCounts.get(block) ?? 0) + 1);
        const names = sequenceNames.get(block) ?? [];
        if (names.length < 5) names.push(use.name);
        sequenceNames.set(block, names);
      }
    }

    const blocks = table.map((entry, index) => {
      const stat = stats.get(index);
      const bytes = Math.max(0, entry.dataEnd - entry.dataStart);
      return {
        index,
        start: entry.dataStart,
        end: entry.dataEnd,
        bytes,
        empty: bytes === 0,
        animations: stat?.animations ?? 0,
        frames: stat?.frames ?? 0,
        seconds: Number((stat?.seconds ?? 0).toFixed(3)),
        frameAnim: stat?.frameAnim ?? 0,
        sectioned: stat?.sectioned ?? 0,
        delta: stat?.delta ?? 0,
        sequenceCount: sequenceCounts.get(index) ?? 0,
        sequences: sequenceNames.get(index) ?? [],
        animationNames: stat?.animationNames ?? [],
      };
    });

    const nonEmpty = blocks.filter((entry) => !entry.empty);
    const headerBytes = nonEmpty[0]?.start ?? 0;
    const used = new Set<number>();
    const missingBlocks = new Set<number>();
    for (const animation of external) {
      if (animation.animBlock >= table.length) missingBlocks.add(animation.animBlock);
      else used.add(animation.animBlock);
    }
    if (missingBlocks.size > 0) {
      warnings.push(
        `${missingBlocks.size} block index(es) referenced by animations are outside the ` +
          `table (${[...missingBlocks].slice(0, 10).join(", ")}).`,
      );
    }
    const orphans = nonEmpty.filter((entry) => !used.has(entry.index)).map((entry) => entry.index);
    if (orphans.length > 0) {
      warnings.push(
        `${orphans.length} non-empty block(s) are not referenced by any animation ` +
          `(${orphans.slice(0, 10).join(", ")}).`,
      );
    }

    if (aniBytes && nonEmpty.length > 0) {
      for (const entry of nonEmpty) {
        if (entry.end > aniBytes.length) {
          warnings.push(
            `Block ${entry.index} ends at ${entry.end}, past the ${aniBytes.length}-byte .ani.`,
          );
          break;
        }
      }
      let previousEnd = nonEmpty[0]!.end;
      let gaps = 0;
      let overlaps = 0;
      for (const entry of nonEmpty.slice(1)) {
        if (entry.start < previousEnd) overlaps += 1;
        else if (entry.start > previousEnd) gaps += 1;
        previousEnd = Math.max(previousEnd, entry.end);
      }
      if (overlaps > 0) warnings.push(`${overlaps} block(s) overlap the preceding block.`);
      if (gaps > 0) warnings.push(`${gaps} gap(s) between consecutive blocks.`);
      const maxEnd = Math.max(...nonEmpty.map((entry) => entry.end));
      if (maxEnd < aniBytes.length) {
        warnings.push(`${aniBytes.length - maxEnd} trailing byte(s) after the last block.`);
      }
    }

    let selected = blocks;
    const wantedBlock = args.block;
    if (wantedBlock !== undefined) {
      selected = selected.filter((entry) => entry.index === wantedBlock);
      if (selected.length === 0) {
        warnings.push(`The table has no block ${wantedBlock}.`);
      }
    }
    const filter = args.sequence?.toLowerCase();
    if (filter) {
      const matching = new Set<number>();
      for (const use of uses) {
        if (!use.name.toLowerCase().includes(filter)) continue;
        for (const block of use.blocks) matching.add(block);
      }
      selected = selected.filter((entry) => matching.has(entry.index));
    }

    return {
      game: gameBlock(game, from),
      path,
      model,
      present: aniBytes !== null,
      aniPath,
      size: aniBytes?.length ?? 0,
      magic: header?.magic ?? null,
      version: header?.version ?? null,
      blockCount: table.length,
      nonEmptyBlocks: nonEmpty.length,
      headerBytes,
      animationCount: animations.length,
      externalAnimations: external.length,
      internalAnimations: internal,
      externalFrames,
      externalSeconds: Number(externalSeconds.toFixed(3)),
      returned: selected.length,
      blocks: selected,
      warnings,
      ...(aniBytes
        ? {}
        : {
            note:
              external.length > 0
                ? "The .ani is not installed; block ranges and clip usage come from the .mdl, " +
                  "but frames cannot be decoded."
                : internal > 0
                  ? "Every animation is stored inside the .mdl; there is no external .ani."
                  : "The model has no animations and no external .ani.",
          }),
    };
  },
});

export const modelAniTools = [readModelAniTool];
