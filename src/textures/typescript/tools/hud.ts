/**
 * VGUI HUD screens: reading a `.res` control tree and editing values in place.
 *
 * A HUD override is a `.res` copied from the game into an add-on and changed: a control
 * moved, a size changed, a field hidden. The files carry `[$WIN32]`/`[!$OSX]` tags,
 * comments and indentation, so the writer splices the value token and leaves everything
 * else byte-identical.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import {
  BACKUP,
  BACKUP_PATH,
  CONFIRM,
  DRY_RUN,
  GAME,
  resolveInput,
} from "../../../core/typescript/tools/paths.js";
import { gameFor } from "../../../core/typescript/games/resolve.js";
import type { Config } from "../../../core/typescript/config.js";
import { openGameVpk } from "../../../assets/typescript/game/vpkcontent.js";
import { applyHudEdits, applyHudOffset, findHudValue } from "../../../formats/typescript/vgui/edit.js";
import { hudControlMatches, parseHud } from "../../../formats/typescript/vgui/res.js";

const HUD_VALUE = z.object({
  key: z.string(),
  value: z.string(),
  condition: z.string().nullable(),
});

const HUD_CONTROL = z.object({
  path: z.string(),
  name: z.string(),
  depth: z.number(),
  condition: z.string().nullable(),
  controlName: z.string().nullable(),
  fieldName: z.string().nullable(),
  xpos: z.string().nullable(),
  ypos: z.string().nullable(),
  wide: z.string().nullable(),
  tall: z.string().nullable(),
  zpos: z.string().nullable(),
  visible: z.string().nullable(),
  enabled: z.string().nullable(),
  values: z.array(HUD_VALUE),
  children: z.number(),
});

const HUD_EDIT = z.object({
  control: z
    .string()
    .describe("Control path (`Audio/SldGameVolume`), or a unique fieldName or block name."),
  key: z.string().describe("Keyvalue to replace or add, e.g. xpos, wide, visible."),
  value: z.string().describe("New value, unquoted."),
  condition: z
    .string()
    .optional()
    .describe(
      "Which conditional pair to edit, e.g. `$WIN32` or `[$OSD]`. Required when the key " +
        "appears more than once; omitted selects the one unconditional pair.",
    ),
});

const APPLIED = z.object({
  control: z.string(),
  key: z.string(),
  value: z.string(),
  condition: z.string().nullable(),
  previous: z.string().nullable(),
  action: z.enum(["replaced", "added", "shifted"]),
});

const OFFSET = z.object({
  x: z.number().default(0).describe("Pixels to add to every selected xpos."),
  y: z.number().default(0).describe("Pixels to add to every selected ypos."),
  controls: z
    .array(z.string())
    .default([])
    .describe(
      "Controls to shift, by path or unique fieldName/name. Empty means every control.",
    ),
  condition: z
    .string()
    .optional()
    .describe("Only shift pairs with this condition, e.g. `$WIN32`."),
});

interface HudSource {
  text: string;
  displayPath: string;
  source: "loose" | "vpk";
}

function loadHudSource(
  args: { path: string; fromGame?: boolean; game?: string },
  config: Config,
): HudSource {
  if (!args.fromGame) {
    const path = resolveInput(args.path, config);
    return { text: readFileSync(path, "utf8"), displayPath: path, source: "loose" };
  }
  const { game } = gameFor(config, args.game);
  const gameDir = game.gameDir ?? config.gameDir;
  if (!gameDir) {
    throw new Error(
      `cannot read a stock HUD from ${game.id}: no -game directory was resolved. ` +
        `Run health to see what discovery found.`,
    );
  }
  const vpk = openGameVpk(gameDir);
  if (!vpk) throw new Error(`cannot open ${gameDir}/pak01_dir.vpk`);
  const internal = args.path.replace(/\\/g, "/").replace(/^\/+/, "");
  const bytes = vpk.read(internal);
  if (!bytes) {
    throw new Error(
      `${internal} is not in pak01_dir.vpk. read_game_content can confirm the name; ` +
        `the engine's own resource path is resource/ui/... .`,
    );
  }
  return { text: bytes.toString("utf8"), displayPath: internal, source: "vpk" };
}

export const readHudTool = defineTool({
  name: "read_hud",
  description:
    "Reads a VGUI `.res` HUD screen: the root resource name and a flat, pre-order list of " +
    "controls with their path, `ControlName`, `fieldName`, geometry (`xpos`, `ypos`, " +
    "`wide`, `tall`), visibility and every keyvalue. Conditions such as `[$WIN32]` and " +
    "`[!$OSX]` are kept, not evaluated: a control that only applies on another platform is " +
    "still in the file and is reported with its tag. `search` matches the path, control " +
    "names, values and conditions. `fromGame: true` reads the stock file out of " +
    "`pak01_dir.vpk`, so a HUD override starts from what the game actually ships. Read-only.",
  realm: "map",
  inputSchema: {
    path: z
      .string()
      .describe(
        "Loose path to the .res, or the in-VPK path when fromGame is set " +
          "(`resource/ui/...`).",
      ),
    fromGame: z
      .boolean()
      .default(false)
      .describe("Read the stock file from the game's pak01_dir.vpk instead of from disk."),
    game: GAME,
    search: z
      .string()
      .optional()
      .describe("Case-insensitive substring over control paths, names, values and conditions."),
    limit: z.number().int().min(1).max(5000).default(500),
  },
  outputSchema: {
    path: z.string(),
    source: z.enum(["loose", "vpk"]),
    root: z.string(),
    bytes: z.number(),
    controlCount: z.number(),
    maxDepth: z.number(),
    returned: z.number(),
    truncated: z.boolean(),
    rootValues: z.array(HUD_VALUE),
    controls: z.array(HUD_CONTROL),
  },
  handler: (args, ctx) => {
    const loaded = loadHudSource(args, ctx.config);
    const document = parseHud(loaded.text);
    const matched = args.search
      ? document.controls.filter((control) => hudControlMatches(control, args.search as string))
      : document.controls;
    const limit = args.limit ?? 500;
    return {
      path: loaded.displayPath,
      source: loaded.source,
      root: document.root,
      bytes: Buffer.byteLength(loaded.text, "utf8"),
      controlCount: document.controls.length,
      maxDepth: document.maxDepth,
      returned: Math.min(matched.length, limit),
      truncated: matched.length > limit,
      rootValues: document.rootValues,
      controls: matched.slice(0, limit).map((control) => ({
        path: control.path,
        name: control.name,
        depth: control.depth,
        condition: control.condition,
        controlName: control.controlName,
        fieldName: control.fieldName,
        xpos: control.xpos,
        ypos: control.ypos,
        wide: control.wide,
        tall: control.tall,
        zpos: control.zpos,
        visible: control.visible,
        enabled: control.enabled,
        values: control.values,
        children: control.children,
      })),
    };
  },
});

export const writeHudTool = defineTool({
  name: "write_hud",
  description:
    "Edits values in a VGUI `.res` HUD screen. Each edit names a control (path, or a unique " +
    "fieldName/block name), a key and a value; an existing value is replaced in place and a " +
    "missing key is added before the control's closing brace. `offset` translates every " +
    "selected `xpos`/`ypos` by a pixel delta while preserving its `c`/`r` alignment, which " +
    "is the HUD batch-offset operation. Conditions are preserved and can select a " +
    "conditional duplicate; an ambiguous key without a condition is refused. Everything " +
    "outside the changed value is copied byte for byte, so comments, indentation and " +
    "`[$WIN32]` tags survive. `fromGame` reads the stock file from the VPK and requires " +
    "`out`; the result is parsed back before writing. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z
      .string()
      .describe(
        "Loose path to the source .res, or the in-VPK path when fromGame is set " +
          "(`resource/ui/...`).",
      ),
    fromGame: z
      .boolean()
      .default(false)
      .describe("Read the stock file from pak01_dir.vpk; `out` is then required."),
    game: GAME,
    edits: z.array(HUD_EDIT).min(1).optional().describe("Value replacements and additions."),
    offset: OFFSET.optional().describe(
      "Translate every selected xpos/ypos by a delta, preserving `c`/`r` alignment.",
    ),
    out: z
      .string()
      .optional()
      .describe(
        "Write here instead of editing `path` in place. Required with fromGame.",
      ),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    source: z.enum(["loose", "vpk"]),
    out: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    verified: z.boolean(),
    controlCount: z.number(),
    edits: z.array(APPLIED),
    offsetSkipped: z.array(z.string()),
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const loaded = loadHudSource(args, ctx.config);
    if (args.fromGame && !args.out) {
      throw new Error(
        "fromGame reads a stock file out of the VPK, which cannot be written; pass `out` " +
          "for the add-on override",
      );
    }
    if ((args.edits ?? []).length === 0 && args.offset === undefined) {
      throw new Error("nothing to do: pass `edits`, `offset`, or both");
    }

    const before = parseHud(loaded.text);
    const offset = args.offset
      ? applyHudOffset(loaded.text, before, args.offset)
      : { text: loaded.text, edits: [], skipped: [] as string[] };
    const offsetDoc = offset.edits.length > 0 ? parseHud(offset.text) : before;
    const edits = args.edits ?? [];
    const applied = edits.length > 0
      ? applyHudEdits(offset.text, offsetDoc, edits)
      : { text: offset.text, edits: [] as typeof offset.edits };
    const text = applied.text;
    const after = parseHud(text);

    const all = [...offset.edits, ...applied.edits];
    const claimed = new Set<string>();
    for (const edit of all) {
      const key = `${edit.control}\u0000${edit.key}\u0000${edit.condition ?? ""}`;
      if (claimed.has(key)) {
        throw new Error(
          `${edit.control} "${edit.key}"${edit.condition ? ` ${edit.condition}` : ""} is ` +
            `touched by both offset and edits; do not overlap the two`,
        );
      }
      claimed.add(key);
    }

    // The oracle: the same reader that produced the control tree must find every new value.
    for (const edit of all) {
      const stored = findHudValue(after, edit.control, edit.key, edit.condition);
      if (stored !== edit.value) {
        throw new Error(
          `refusing to write: ${edit.control} "${edit.key}" was set to ${JSON.stringify(
            edit.value,
          )} but reads back as ${JSON.stringify(stored)}`,
        );
      }
    }

    const target = args.out ? resolveInput(args.out, ctx.config) : loaded.displayPath;
    const targetBefore = existsSync(target) ? readFileSync(target, "utf8") : null;
    const unchanged = targetBefore === text;
    const write = writeGuarded(target, text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup && targetBefore !== null,
      unchanged,
    });

    return {
      path: loaded.displayPath,
      source: loaded.source,
      out: target,
      written: write.written,
      backupPath: write.backupPath,
      unchanged,
      verified: true,
      controlCount: after.controls.length,
      edits: all,
      offsetSkipped: offset.skipped,
      bytesBefore: Buffer.byteLength(loaded.text, "utf8"),
      bytesAfter: Buffer.byteLength(text, "utf8"),
      note:
        loaded.source === "vpk"
          ? `copied ${loaded.displayPath} from pak01_dir.vpk to ${target}`
          : target === loaded.displayPath
            ? "edited in place; the source .res is the add-on override"
            : `wrote an add-on copy; ${loaded.displayPath} was not changed`,
    };
  },
});

export const hudTools = [readHudTool, writeHudTool];
