/**
 * Detail sprites: the `detail.vbsp` type that scatters a sprite across displacement faces.
 * It is KeyValues, but a hand edit that adds the block in the wrong place is silently
 * ignored, so the block is spliced into `detail` and parsed back.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock, KvPair } from "../../../formats/typescript/kv/parse.js";

const blockOf = (nodes: ReturnType<typeof parse>, name: string): KvBlock | null =>
  (nodes.find(
    (node): node is KvBlock => node.kind === "block" && node.name.toLowerCase() === name.toLowerCase(),
  ) ?? null);

export const writeDetailSpritesTool = defineTool({
  name: "write_detail_sprites",
  description:
    "Adds a detail-sprite type to `detail.vbsp`: density, one sprite group with a sprite " +
    "rectangle (`x y w h sheetSize`), `spritesize` (x y z random), amount and alpha. A map " +
    "uses it through worldspawn's `detailvbsp` and `detailmaterial` (the VMT pointing at the " +
    "sprite sheet). Refuses a duplicate type and an existing file without `overwrite` only " +
    "for that type. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("detail.vbsp path, absolute or relative to the repo root."),
    name: z.string().min(1).describe("Detail type name, e.g. my_grass."),
    density: z.number().positive().default(1000),
    sprite: z
      .string()
      .default("0 0 128 128 512")
      .describe("x y width height sheet-size, as the stock detail.vbsp writes it."),
    spritesize: z
      .string()
      .default("0.5 0.0 15 25")
      .describe("x y z random-scale, four numbers."),
    amount: z.number().nonnegative().default(1),
    alpha: z.number().min(0).max(1).default(1),
    overwrite: z.boolean().default(false).describe("Replace an existing type of the same name."),
    backup: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    name: z.string(),
    written: z.boolean(),
    backupPath: z.string().nullable(),
    types: z.array(z.string()),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const sprite = args.sprite ?? "0 0 128 128 512";
    const spritesize = args.spritesize ?? "0.5 0.0 15 25";
    const density = args.density ?? 1000;
    const amount = args.amount ?? 1;
    const alpha = args.alpha ?? 1;
    if (!/^\s*\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+(\.\d+)?\s*$/.test(sprite)) {
      throw new Error("sprite must be five numbers: x y width height sheet-size");
    }
    if (!/^\s*-?\d+(\.\d+)?(\s+-?\d+(\.\d+)?){3}\s*$/.test(spritesize)) {
      throw new Error("spritesize must be four numbers");
    }
    const exists = existsSync(path);
    let text = exists ? readFileSync(path, "utf8") : "detail\n{\n}\n";
    let nodes = parse(text);
    let root = blockOf(nodes, "detail");
    if (!root) throw new Error(`${path} has no detail block`);
    const existing = blockOf(root.entries, args.name);
    if (existing && args.overwrite !== true) {
      throw new Error(`${path} already has a detail type ${args.name}`);
    }
    const escaped = args.name.replace(/"/g, "");
    if (existing) {
      text = text.slice(0, existing.start) + text.slice(existing.end);
      nodes = parse(text);
      root = blockOf(nodes, "detail");
      if (!root) throw new Error("detail.vbsp lost its root after replacing a type");
    }
    const indent = "\t";
    const block =
      `${indent}${escaped}\n` +
      `${indent}{\n` +
      `${indent}\t"density"\t\t"${density}"\n` +
      `${indent}\tGroup1\n` +
      `${indent}\t{\n` +
      `${indent}\t\t"alpha"\t\t"${alpha}"\n` +
      `${indent}\t\tModel1\n` +
      `${indent}\t\t{\n` +
      `${indent}\t\t\t"sprite"\t\t"${sprite}"\n` +
      `${indent}\t\t\t"spritesize"\t"${spritesize}"\n` +
      `${indent}\t\t\t"amount"\t\t"${amount}"\n` +
      `${indent}\t\t}\n` +
      `${indent}\t}\n` +
      `${indent}\tGroup2\n` +
      `${indent}\t{\n` +
      `${indent}\t\t"alpha"\t\t"0.0"\n` +
      `${indent}\t}\n` +
      `${indent}}\n`;
    const before = text.slice(0, root.bodyEnd);
    text = before + (before.endsWith("\n") ? "" : "\n") + block + text.slice(root.bodyEnd);
    nodes = parse(text);
    root = blockOf(nodes, "detail");
    if (!root || !blockOf(root.entries, args.name)) {
      throw new Error("the detail type did not read back after the write");
    }
    const types = root.entries
      .filter((node): node is KvBlock => node.kind === "block")
      .map((node) => node.name);
    const write = writeGuarded(path, text, ctx.config, {
      backup: args.backup === true,
      unchanged: false,
    });
    return {
      path,
      name: args.name,
      written: write.written,
      backupPath: write.backupPath,
      types,
      warnings: [],
      nextStep:
        "Set worldspawn `detailvbsp` to this file and `detailmaterial` to the VMT whose " +
        "$basetexture is the sprite sheet; only displacement faces scatter it.",
    };
  },
});

export const readDetailSpritesTool = defineTool({
  name: "read_detail_sprites",
  description:
    "Reads a `detail.vbsp`: every detail type, its density, and the groups/models inside " +
    "it (sprite or model, amount, alpha). Use it to check a hand edit or to find the type " +
    "name worldspawn's `detailmaterial` should scatter.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("detail.vbsp path, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    types: z.array(
      z.object({
        name: z.string(),
        density: z.string().nullable(),
        groups: z.array(z.object({ name: z.string(), alpha: z.string().nullable(), models: z.number() })),
      }),
    ),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const nodes = parse(readFileSync(path, "utf8"));
    const root = blockOf(nodes, "detail");
    if (!root) throw new Error(`${path} has no detail block`);
    const types = root.entries
      .filter((node): node is KvBlock => node.kind === "block")
      .map((type) => {
        const density =
          type.entries.find((entry): entry is KvPair => entry.kind === "pair" && entry.key.toLowerCase() === "density")
            ?.value ?? null;
        const groups = type.entries
          .filter((node): node is KvBlock => node.kind === "block" && /^group/i.test(node.name))
          .map((group) => ({
            name: group.name,
            alpha:
              group.entries.find(
                (entry): entry is KvPair => entry.kind === "pair" && entry.key.toLowerCase() === "alpha",
              )?.value ?? null,
            models: group.entries.filter((entry) => entry.kind === "block" && /^model/i.test(entry.name)).length,
          }));
        return { name: type.name, density, groups };
      });
    return { path, types, warnings: types.length === 0 ? ["no detail types"] : [] };
  },
});

export const detailTools = [writeDetailSpritesTool, readDetailSpritesTool];
