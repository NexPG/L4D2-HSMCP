/**
 * Content manifests: the three lists that make a custom asset load at all.
 *
 * A `.pcf`, a `game_sounds_*.txt` or a `soundscapes_*.txt` can sit in the addon and never be
 * read. The engine only looks at the manifest entry. These files are KeyValues, but they are
 * hand-written with comments, so the writer splices one line and leaves every other byte
 * alone rather than re-serialising the tree.
 */
import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock, KvNode, KvPair } from "../../../formats/typescript/kv/parse.js";

const KIND = z.enum(["particles", "sounds", "soundscapes"]);

const SHAPE = {
  particles: { blocks: ["particles_manifest"], key: "file", prefix: "particles/", suffix: ".pcf" },
  sounds: { blocks: ["game_sounds_manifest"], key: "precache_file", prefix: "scripts/", suffix: ".txt" },
  soundscapes: {
    // Valve ships the block as `soundscaples_manifest` (yes, with the typo). Accept the
    // spelling a person would write too, but create the one the stock file uses.
    blocks: ["soundscaples_manifest", "soundscapes_manifest"],
    key: "file",
    prefix: "scripts/",
    suffix: ".txt",
  },
} as const;

type Kind = z.infer<typeof KIND>;

function normalize(kind: Kind, raw: string): string {
  let value = raw.trim().replace(/\\/g, "/");
  if (value.length === 0) throw new Error("an empty manifest entry is not a file");
  const bang = value.startsWith("!") ? "!" : "";
  if (bang) value = value.slice(1);
  const shape = SHAPE[kind];
  if (!value.toLowerCase().startsWith(shape.prefix)) value = shape.prefix + value;
  if (!value.toLowerCase().endsWith(shape.suffix)) value += shape.suffix;
  return bang + value;
}

function findBlock(nodes: readonly KvNode[], kind: Kind, override?: string): KvBlock | null {
  const names = new Set(
    (override ? [override] : SHAPE[kind].blocks).map((name) => name.toLowerCase()),
  );
  for (const node of nodes) {
    if (node.kind === "block" && names.has(node.name.toLowerCase())) return node;
  }
  return null;
}

function entries(block: KvBlock, key: string): KvPair[] {
  return block.entries.filter(
    (node): node is KvPair => node.kind === "pair" && node.key.toLowerCase() === key.toLowerCase(),
  );
}

function removeRange(text: string, pair: KvPair): { start: number; end: number } {
  const start = text.lastIndexOf("\n", pair.start) + 1;
  const newline = text.indexOf("\n", pair.end);
  return { start, end: newline === -1 ? text.length : newline + 1 };
}

/** A block with the stock indentation, used when the file does not exist yet. */
function skeleton(kind: Kind, override: string | undefined, value: string): string {
  const block = override ?? SHAPE[kind].blocks[0]!;
  return `${block}\n{\n\t"${SHAPE[kind].key}"\t\t"${value}"\n}\n`;
}

export const writeContentManifestTool = defineTool({
  name: "write_content_manifest",
  description:
    "Adds or removes entries in a content manifest: `particles_manifest.txt` (`file`), " +
    "`game_sounds_manifest.txt` (`precache_file`) or `soundscapes_manifest.txt` (`file`). " +
    "A custom `.pcf` or soundscript that is not listed is never loaded, which is the usual " +
    "reason a shipped asset is silent. Paths are normalized to the game-root form " +
    "(`particles/x.pcf`, `scripts/x.txt`); a duplicate is skipped case-insensitively. The " +
    "file is spliced, not re-serialised, so comments and existing entries survive. A new " +
    "file gets the block name Valve's own manifest uses, including the stock " +
    "`soundscaples_manifest` typo. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Manifest path, absolute or relative to the repo root."),
    kind: KIND,
    add: z.array(z.string()).default([]).describe("Entries to append."),
    remove: z.array(z.string()).default([]).describe("Entries to remove, matched case-insensitively."),
    block: z.string().optional().describe("Override the block name (rare)."),
    create: z.boolean().default(true).describe("Create the manifest when it does not exist."),
    dryRun: z.boolean().default(false),
    backup: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    kind: KIND,
    block: z.string(),
    written: z.boolean(),
    backupPath: z.string().nullable(),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    skipped: z.array(z.string()),
    missing: z.array(z.string()),
    present: z.array(z.string()),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const kind = args.kind;
    const shape = SHAPE[kind];
    const add = (args.add ?? []).map((value) => normalize(kind, value));
    const remove = (args.remove ?? []).map((value) => normalize(kind, value));
    if (add.length === 0 && remove.length === 0) {
      throw new Error("give at least one entry to add or remove");
    }
    if (!existsSync(path) && args.create === false) {
      throw new Error(`${path} does not exist and create is false`);
    }

    const originalText = existsSync(path) ? readFileSync(path, "utf8") : "";
    let text = originalText;
    let nodes = text.length > 0 ? parse(text) : [];
    let block = findBlock(nodes, kind, args.block);
    const warnings: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];
    const missing: string[] = [];

    if (!block) {
      if (remove.length > 0) {
        throw new Error(
          `${path} has no ${args.block ?? shape.blocks[0]} block, so there is nothing to remove`,
        );
      }
      if (args.create === false) {
        throw new Error(`${path} has no ${args.block ?? shape.blocks[0]} block`);
      }
      const first = add.shift();
      if (first === undefined) throw new Error("a new manifest needs at least one entry");
      text = skeleton(kind, args.block, first);
      nodes = parse(text);
      block = findBlock(nodes, kind, args.block);
      if (!block) throw new Error("the new manifest did not parse back with its block");
      added.push(first);
    } else {
      // Apply removals from the end so earlier offsets stay valid.
      const ranges: Array<{ start: number; end: number; value: string }> = [];
      for (const value of remove) {
        const match = entries(block, shape.key).find(
          (pair) => pair.value.toLowerCase() === value.toLowerCase(),
        );
        if (match) {
          ranges.push({ ...removeRange(text, match), value: match.value });
          removed.push(match.value);
        } else {
          missing.push(value);
        }
      }
      ranges.sort((a, b) => b.start - a.start);
      for (const range of ranges) {
        text = text.slice(0, range.start) + text.slice(range.end);
      }
      nodes = parse(text);
      block = findBlock(nodes, kind, args.block);
      if (!block) throw new Error("the manifest no longer has its block after removal");
    }

    const present = entries(block, shape.key).map((pair) => pair.value);
    const lower = new Set(present.map((value) => value.toLowerCase()));
    const skipped: string[] = [];
    for (const value of add) {
      if (lower.has(value.toLowerCase())) {
        skipped.push(value);
        continue;
      }
      lower.add(value.toLowerCase());
      added.push(value);
    }

    if (added.length > 0) {
      const before = text.slice(0, block.bodyEnd);
      const prefix = before.endsWith("\n") ? "" : "\n";
      const lines = added.map((value) => `\t"${shape.key}"\t\t"${value}"\n`).join("");
      text = before + prefix + lines + text.slice(block.bodyEnd);
      nodes = parse(text);
      block = findBlock(nodes, kind, args.block);
      if (!block) throw new Error("the manifest no longer has its block after the add");
    }

    const after = entries(block, shape.key).map((pair) => pair.value);
    const afterLower = new Set(after.map((value) => value.toLowerCase()));
    const notWritten = add.filter((value) => !afterLower.has(value.toLowerCase()));
    if (notWritten.length > 0) {
      throw new Error(`the write did not read back with ${notWritten.join(", ")}`);
    }
    const duplicates = after.length - new Set(after.map((value) => value.toLowerCase())).size;
    if (duplicates > 0) {
      warnings.push(
        `${duplicates} duplicate ${shape.key} value(s) already exist; the engine reads them but a manifest should not repeat a file`,
      );
    }

    const write = writeGuarded(path, text, ctx.config, {
      backup: args.backup === true,
      dryRun: args.dryRun === true,
      unchanged: originalText === text,
    });
    return {
      path,
      kind,
      block: block.name,
      written: write.written,
      backupPath: write.backupPath,
      added,
      removed,
      skipped,
      missing,
      present: after,
      warnings,
    };
  },
});

export const manifestTools = [writeContentManifestTool];
