/**
 * Localization files: the `lang`/`Tokens` KeyValues the game reads for names, captions and
 * addon text. Closecaption is UTF-16LE with a BOM; an addon file with the wrong encoding
 * loads as mojibake or not at all, so the writer preserves the encoding it found.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock, KvNode, KvPair } from "../../../formats/typescript/kv/parse.js";

const ENCODING = z.enum(["utf16le", "utf8"]);

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function findBlock(nodes: readonly KvNode[], name: string): KvBlock | null {
  for (const node of nodes) {
    if (node.kind === "block" && node.name.toLowerCase() === name.toLowerCase()) return node;
  }
  return null;
}

function tokenPairs(block: KvBlock): KvPair[] {
  return block.entries.filter((node): node is KvPair => node.kind === "pair");
}

function skeleton(language: string, tokens: Record<string, string>): string {
  const lines = Object.entries(tokens)
    .map(([key, value]) => `\t\t${quote(key)}\t\t${quote(value)}`)
    .join("\n");
  return (
    '"lang"\n{\n' +
    `\t"Language"\t${quote(language)}\n` +
    '\t"Tokens"\n\t{\n' +
    (lines.length > 0 ? `${lines}\n` : "") +
    "\t}\n}\n"
  );
}

export const writeLocalizationTool = defineTool({
  name: "write_localization",
  description:
    "Writes or updates a Valve localization file (`\"lang\" { \"Language\" ... \"Tokens\" { ... } }`). " +
    "The closecaption file is UTF-16LE with a BOM; an existing file's encoding is preserved, " +
    "and a new file defaults to UTF-16LE. Existing tokens and comments are kept; a token is " +
    "updated in place, a new one is inserted before the Tokens block's closing brace, and the " +
    "result is parsed back and checked. Use it for `resource/closecaption_english.txt`, " +
    "campaign/chapter titles and addon text. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Localization file, absolute or relative to the repo root."),
    language: z.string().default("English").describe("The `Language` value."),
    tokens: z.record(z.string()).describe("Token key to display text."),
    encoding: ENCODING.optional().describe(
      "New-file encoding. Existing files keep the encoding they already have.",
    ),
    create: z.boolean().default(true).describe("Create the file when it does not exist."),
    backup: z.boolean().default(false),
    dryRun: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: z.string().nullable(),
    encoding: ENCODING,
    language: z.string(),
    added: z.array(z.string()),
    updated: z.array(z.string()),
    unchanged: z.array(z.string()),
    tokenCount: z.number(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const tokens = args.tokens ?? {};
    if (Object.keys(tokens).length === 0) throw new Error("give at least one token");

    const exists = existsSync(path);
    if (!exists && args.create === false) throw new Error(`${path} does not exist`);

    let raw = exists ? readFileSync(path) : Buffer.alloc(0);
    let encoding: z.infer<typeof ENCODING> = args.encoding ?? "utf16le";
    if (exists) {
      if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
        encoding = "utf16le";
        raw = raw.subarray(2);
      } else {
        encoding = "utf8";
      }
    }
    let text = exists ? raw.toString(encoding) : skeleton(args.language ?? "English", {});
    let nodes = text.length > 0 ? parse(text) : [];
    let lang = findBlock(nodes, "lang");
    if (!lang) {
      if (!exists && args.create !== false) {
        text = skeleton(args.language ?? "English", {});
        nodes = parse(text);
        lang = findBlock(nodes, "lang");
      }
      if (!lang) throw new Error(`${path} has no "lang" block`);
    }

    let tokensBlock = findBlock(lang.entries, "Tokens");
    if (!tokensBlock) {
      if (args.create === false) throw new Error(`${path} has no "Tokens" block`);
      const lines = Object.entries(tokens)
        .map(([key, value]) => `\t\t${quote(key)}\t\t${quote(value)}`)
        .join("\n");
      const insert =
        `\n\t"Tokens"\n\t{\n${lines}\n\t}\n`;
      text = text.slice(0, lang.bodyEnd) + insert + text.slice(lang.bodyEnd);
      nodes = parse(text);
      lang = findBlock(nodes, "lang");
      if (!lang) throw new Error("the localization no longer has its lang block");
      tokensBlock = findBlock(lang.entries, "Tokens");
      if (!tokensBlock) throw new Error("the Tokens block was not created");
    }

    const existing = new Map<string, KvPair>();
    for (const pair of tokenPairs(tokensBlock)) {
      const key = pair.key.toLowerCase();
      if (!existing.has(key)) existing.set(key, pair);
    }
    const added: string[] = [];
    const updated: string[] = [];
    const unchanged: string[] = [];
    const insertions: Array<{ key: string; value: string }> = [];

    // Update existing tokens from the end so offsets stay valid.
    const updates: Array<{ pair: KvPair; key: string; value: string }> = [];
    for (const [key, value] of Object.entries(tokens)) {
      const pair = existing.get(key.toLowerCase());
      if (!pair) {
        insertions.push({ key, value });
        continue;
      }
      if (pair.value === value) {
        unchanged.push(key);
        continue;
      }
      updates.push({ pair, key: pair.key, value });
    }
    updates.sort((a, b) => b.pair.start - a.pair.start);
    for (const update of updates) {
      text =
        text.slice(0, update.pair.start) +
        `${quote(update.key)}\t\t${quote(update.value)}` +
        text.slice(update.pair.end);
      updated.push(update.key);
    }
    if (updates.length > 0) {
      nodes = parse(text);
      lang = findBlock(nodes, "lang");
      if (!lang) throw new Error("the localization lost its lang block");
      tokensBlock = findBlock(lang.entries, "Tokens");
      if (!tokensBlock) throw new Error("the localization lost its Tokens block");
    }

    if (insertions.length > 0) {
      const before = text.slice(0, tokensBlock.bodyEnd);
      const prefix = before.endsWith("\n") ? "" : "\n";
      const lines = insertions
        .map((entry) => `\t\t${quote(entry.key)}\t\t${quote(entry.value)}\n`)
        .join("");
      text = before + prefix + lines + text.slice(tokensBlock.bodyEnd);
      added.push(...insertions.map((entry) => entry.key));
    }

    // The oracle: parse the result and compare the values that were asked for.
    nodes = parse(text);
    lang = findBlock(nodes, "lang");
    if (!lang) throw new Error("the localization no longer parses with a lang block");
    tokensBlock = findBlock(lang.entries, "Tokens");
    if (!tokensBlock) throw new Error("the localization no longer parses with a Tokens block");
    const after = new Map(tokenPairs(tokensBlock).map((pair) => [pair.key.toLowerCase(), pair.value]));
    const wrong = Object.entries(tokens).filter(([key, value]) => after.get(key.toLowerCase()) !== value);
    if (wrong.length > 0) {
      throw new Error(`the write did not read back: ${wrong.map(([key]) => key).join(", ")}`);
    }

    const original = exists ? readFileSync(path) : null;
    const bytes =
      encoding === "utf16le"
        ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")])
        : Buffer.from(text, "utf8");
    const changed = original === null || !original.equals(bytes);
    let written = false;
    let backupPath: string | null = null;
    if (changed && args.dryRun !== true) {
      const target = assertWritable(path, ctx.config);
      if (args.backup === true && exists) {
        backupPath = assertWritable(`${target}.bak`, ctx.config);
        copyFileSync(target, backupPath);
      }
      writeFileSync(target, bytes);
      written = true;
    }

    return {
      path,
      written,
      backupPath,
      encoding,
      language: args.language ?? "English",
      added,
      updated,
      unchanged,
      tokenCount: tokenPairs(tokensBlock).length,
      warnings: [],
    };
  },
});

export const readLocalizationTool = defineTool({
  name: "read_localization",
  description:
    "Reads a `lang`/`Tokens` file: detected encoding (UTF-16LE/BOM or UTF-8), language, " +
    "every token and duplicate count. Use it after `write_localization` or on a stock " +
    "`closecaption_english.txt` to see exactly what the engine will read.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Localization file, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    encoding: ENCODING,
    language: z.string().nullable(),
    tokens: z.record(z.string()),
    tokenCount: z.number(),
    duplicates: z.array(z.string()),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    let raw = readFileSync(path);
    let encoding: z.infer<typeof ENCODING> = "utf8";
    if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
      encoding = "utf16le";
      raw = raw.subarray(2);
    }
    const text = raw.toString(encoding);
    const nodes = parse(text);
    const lang = findBlock(nodes, "lang");
    if (!lang) throw new Error(`${path} has no lang block`);
    const language = lang.entries.find(
      (entry): entry is KvPair => entry.kind === "pair" && entry.key.toLowerCase() === "language",
    )?.value ?? null;
    const tokensBlock = findBlock(lang.entries, "Tokens");
    if (!tokensBlock) throw new Error(`${path} has no Tokens block`);
    const tokens: Record<string, string> = {};
    const duplicates: string[] = [];
    for (const pair of tokenPairs(tokensBlock)) {
      if (Object.prototype.hasOwnProperty.call(tokens, pair.key)) duplicates.push(pair.key);
      else tokens[pair.key] = pair.value;
    }
    return {
      path,
      encoding,
      language,
      tokens,
      tokenCount: Object.keys(tokens).length,
      duplicates,
      warnings: duplicates.length ? ["duplicate token keys: the engine reads the first"] : [],
    };
  },
});

export const localizationTools = [writeLocalizationTool, readLocalizationTool];
