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
  resolveInput,
} from "../../../core/typescript/tools/paths.js";
import { applyHudEdits, findHudValue } from "../../../formats/typescript/vgui/edit.js";
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
  action: z.enum(["replaced", "added"]),
});

export const readHudTool = defineTool({
  name: "read_hud",
  description:
    "Reads a VGUI `.res` HUD screen: the root resource name and a flat, pre-order list of " +
    "controls with their path, `ControlName`, `fieldName`, geometry (`xpos`, `ypos`, " +
    "`wide`, `tall`), visibility and every keyvalue. Conditions such as `[$WIN32]` and " +
    "`[!$OSX]` are kept, not evaluated: a control that only applies on another platform is " +
    "still in the file and is reported with its tag. `search` matches the path, control " +
    "names, values and conditions. Read-only.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .res file, absolute or relative to the repo root."),
    search: z
      .string()
      .optional()
      .describe("Case-insensitive substring over control paths, names, values and conditions."),
    limit: z.number().int().min(1).max(5000).default(500),
  },
  outputSchema: {
    path: z.string(),
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
    const path = resolveInput(args.path, ctx.config);
    const source = readFileSync(path, "utf8");
    const document = parseHud(source);
    const matched = args.search
      ? document.controls.filter((control) => hudControlMatches(control, args.search as string))
      : document.controls;
    const limit = args.limit ?? 500;
    return {
      path,
      root: document.root,
      bytes: Buffer.byteLength(source, "utf8"),
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
    "missing key is added before the control's closing brace. Conditions are preserved and " +
    "can select a conditional duplicate; an ambiguous key without a condition is refused. " +
    "Everything outside the changed value is copied byte for byte, so comments, indentation " +
    "and `[$WIN32]` tags survive. `out` writes an add-on copy instead of changing the source. " +
    "The result is parsed back before writing. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the source .res, absolute or relative to the repo root."),
    edits: z.array(HUD_EDIT).min(1),
    out: z
      .string()
      .optional()
      .describe(
        "Write here instead of editing `path` in place. Use it to build an add-on override.",
      ),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    out: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    verified: z.boolean(),
    controlCount: z.number(),
    edits: z.array(APPLIED),
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const source = readFileSync(path, "utf8");
    const before = parseHud(source);
    const applied = applyHudEdits(source, before, args.edits);
    const after = parseHud(applied.text);

    // The oracle: the same reader that produced the control tree must find every new value.
    for (const edit of applied.edits) {
      const stored = findHudValue(after, edit.control, edit.key, edit.condition);
      if (stored !== edit.value) {
        throw new Error(
          `refusing to write: ${edit.control} "${edit.key}" was set to ${JSON.stringify(
            edit.value,
          )} but reads back as ${JSON.stringify(stored)}`,
        );
      }
    }

    const target = args.out ? resolveInput(args.out, ctx.config) : path;
    const targetBefore = existsSync(target) ? readFileSync(target, "utf8") : null;
    const unchanged = targetBefore === applied.text;
    const write = writeGuarded(target, applied.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup && targetBefore !== null,
      unchanged,
    });

    return {
      path,
      out: target,
      written: write.written,
      backupPath: write.backupPath,
      unchanged,
      verified: true,
      controlCount: after.controls.length,
      edits: applied.edits,
      bytesBefore: Buffer.byteLength(source, "utf8"),
      bytesAfter: Buffer.byteLength(applied.text, "utf8"),
      note:
        target === path
          ? "edited in place; the source .res is the add-on override"
          : `wrote an add-on copy; ${path} was not changed`,
    };
  },
});

export const hudTools = [readHudTool, writeHudTool];
