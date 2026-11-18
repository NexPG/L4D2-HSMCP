/**
 * Live Hammer / Hammer++ tools.
 *
 * Portions ported from Hammer-MCP (https://github.com/EpicMorg/Hammer-MCP),
 * MIT License, Copyright (c) 2026 EpicMorg. The shell-channel command and menu ids are
 * adapted to this project's tool contracts. The full notice is in THIRD-PARTY-NOTICES.md.
 */
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM } from "../../../core/typescript/tools/paths.js";

const VEC3 = z.array(z.number()).length(3);

/** Hammer main-menu ids, identical across the Source Hammer builds we checked. */
const MENU = {
  save: 57603,
  saveAs: 57604,
  runMap: 32903,
  undo: 57643,
  redo: 57644,
  checkForProblems: 32930,
  loadPointfile: 33021,
  unloadPointfile: 33022,
  centerOnSelection: 32918,
  goToBrushNumber: 33061,
  selectAll: 32875,
  entityReport: 32996,
  showConnections: 32931,
} as const;

const EDITOR = z.object({
  pid: z.number(),
  name: z.string().nullable(),
  exe: z.string().nullable(),
  shellWindow: z.number(),
  mainWindow: z.number(),
  hasShell: z.boolean(),
  titles: z.array(z.string()),
  openMap: z.string().nullable(),
  /**
   * `true` when Hammer marks the map with `*` in the title — proof of unsaved changes.
   * `null` means the title carries no marker: some builds never add one (Hammer++ 8873 x86
   * was measured with an edited map open), so absence is not proof that the map is saved.
   */
  modified: z.boolean().nullable(),
  /**
   * Exact build, when the editor DLL matches the registry of known builds
   * (`src/hammer/data/hammers.json`). Null for an unknown build.
   */
  build: z
    .object({
      id: z.string().nullable(),
      family: z.string().nullable(),
      branch: z.string().nullable(),
      build: z.number().nullable(),
      arch: z.string().nullable(),
      shell: z.boolean().nullable(),
    })
    .nullable(),
});

export const hammerStatusTool = defineTool({
  name: "hammer_status",
  description:
    "Lists running Hammer / Hammer++ / J.A.C.K. / Sledge editors, their process id, main " +
    "window, shell-channel window, open map path from the title, whether that map has " +
    "unsaved changes, the exact editor build when its DLL is known, and whether the live " +
    "shell channel is available. The shell channel is the editor's built-in " +
    "`Worldcraft_ShellMessageWnd`; it is write-only and entity-level. Use it before " +
    "`hammer_live_edit` or `hammer_menu`. Read-only, no game process involved.",
  realm: "local",
  inputSchema: {},
  outputSchema: { count: z.number(), editors: z.array(EDITOR) },
  handler: async (_args, ctx) => {
    return (await callSidecar("hammer_live", { action: "status" }, ctx.config, 30_000)) as {
      count: number;
      editors: z.infer<typeof EDITOR>[];
    };
  },
});

const OP = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    classname: z.string(),
    origin: VEC3,
    keyvalues: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    op: z.literal("setKeyvalue"),
    classname: z.string(),
    origin: VEC3,
    key: z.string(),
    value: z.string(),
  }),
  z.object({
    op: z.literal("delete"),
    classname: z.string(),
    origin: VEC3,
  }),
  z.object({
    op: z.literal("rotate"),
    classname: z.string(),
    origin: VEC3,
    angles: VEC3.describe("Incremental pitch yaw roll, in degrees."),
  }),
]);

function number(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
}

function quote(value: string): string {
  if (value.includes('"')) {
    throw new Error(
      "the Hammer shell channel has no escaping; a double quote in a keyvalue would end " +
        "the token. Remove it or set the value through the VMF writer instead.",
    );
  }
  return `"${value}"`;
}

export function shellCommandsFor(op: z.infer<typeof OP>): string[] {
  const at = `${number(op.origin[0]!)} ${number(op.origin[1]!)} ${number(op.origin[2]!)}`;
  if (op.op === "create") {
    return [
      `entity_create ${op.classname} ${at}`,
      ...Object.entries(op.keyvalues ?? {}).map(
        ([key, value]) =>
          `entity_set_keyvalue ${op.classname} ${number(op.origin[0]!)} ${number(op.origin[1]!)} ${number(op.origin[2]!)} ${quote(key)} ${quote(value)}`,
      ),
    ];
  }
  if (op.op === "setKeyvalue") {
    return [
      `entity_set_keyvalue ${op.classname} ${number(op.origin[0]!)} ${number(op.origin[1]!)} ${number(op.origin[2]!)} ${quote(op.key)} ${quote(op.value)}`,
    ];
  }
  if (op.op === "delete") {
    return [`entity_delete ${op.classname} ${at}`];
  }
  return [
    `entity_rotate_incremental ${op.classname} ${number(op.origin[0]!)} ${number(op.origin[1]!)} ${number(op.origin[2]!)} ${number(op.angles[0]!)} ${number(op.angles[1]!)} ${number(op.angles[2]!)}`,
  ];
}

export const hammerLiveEditTool = defineTool({
  name: "hammer_live_edit",
  description:
    "Edits the map that is open in Hammer / Hammer++ through the editor's shell channel: " +
    "create a point entity (and set its keyvalues), set a keyvalue, delete an entity, or " +
    "rotate it. The commands land in Hammer's undo history, so Ctrl+Z works. The channel " +
    "addresses entities by class + origin and cannot create brushes or move entities; use " +
    "the VMF writers for geometry. `vmf` must be the saved map that is open in the editor; " +
    "it is used only to open the shell session. `save: true` runs Hammer's Save command " +
    "afterwards, which is what makes the change visible to the file readers. Guarded.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    pid: z
      .number()
      .int()
      .optional()
      .describe("Editor process id from hammer_status. Defaults to the first shell-capable editor."),
    vmf: z.string().describe("Saved VMF open in that editor, absolute or repo-relative."),
    ops: z.array(OP).min(1),
    save: z.boolean().default(false).describe("Run Hammer's Save menu command after the edits."),
    confirm: CONFIRM,
  },
  outputSchema: {
    pid: z.number(),
    vmf: z.string(),
    session: z.boolean(),
    acceptedVersion: z.number().nullable(),
    accepted: z.number(),
    rejected: z.number(),
    results: z.array(z.object({ accepted: z.boolean(), command: z.string() })),
    saved: z.boolean(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const status = (await callSidecar("hammer_live", { action: "status" }, ctx.config, 30_000)) as {
      editors: Array<{ pid: number; hasShell: boolean; openMap: string | null }>;
    };
    const editor = args.pid
      ? status.editors.find((e) => e.pid === args.pid)
      : status.editors.find((e) => e.hasShell);
    if (!editor) {
      throw new Error(
        args.pid
          ? `no editor with pid ${args.pid}; run hammer_status`
          : "no running Hammer with a shell channel; open a map in Hammer++ first",
      );
    }
    if (!editor.hasShell) {
      throw new Error(
        `editor ${editor.pid} has no shell channel. Hammer++ 8867+ and stock Hammer have ` +
          "one; this build does not. Writing the VMF is still available.",
      );
    }
    const vmf = args.vmf;
    const commands = args.ops.flatMap(shellCommandsFor);
    const reply = (await callSidecar(
      "hammer_live",
      { action: "batch", pid: editor.pid, vmf, commands },
      ctx.config,
      120_000,
    )) as {
      session: boolean;
      acceptedVersion?: number;
      accepted: number;
      rejected: number;
      results: Array<{ accepted: boolean; command: string }>;
      reason?: string;
    };
    if (!reply.session) {
      throw new Error(reply.reason ?? "Hammer refused the edit session");
    }
    let saved = false;
    if (args.save) {
      const menuReply = (await callSidecar(
        "hammer_live",
        { action: "menu", pid: editor.pid, commandId: MENU.save },
        ctx.config,
        30_000,
      )) as { posted: boolean };
      saved = menuReply.posted;
    }
    return {
      pid: editor.pid,
      vmf,
      session: true,
      acceptedVersion: reply.acceptedVersion ?? null,
      accepted: reply.accepted,
      rejected: reply.rejected,
      results: reply.results,
      saved,
      note:
        "The shell channel is entity-level. A rejected command means Hammer could not find " +
        "the class+origin, or the build does not support that command. Save is a menu " +
        "command; if `saved` is false the in-memory edit is still in Hammer's undo history.",
    };
  },
});

export const hammerMenuTool = defineTool({
  name: "hammer_menu",
  description:
    "Posts a main-menu command to the running Hammer / Hammer++ window: save, save as, " +
    "Run Map, undo, redo, Check for Problems, load/unload pointfile, center on selection, " +
    "select all, entity report, show connections, go to brush number. Menu ids are the " +
    "same across the Source Hammer builds checked. This is the live editor's own command, " +
    "not a reimplementation; it is how an agent triggers Save or Run Map without a mouse.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    pid: z.number().int().optional().describe("Editor process id; defaults to the first editor."),
    command: z.enum(Object.keys(MENU) as [keyof typeof MENU, ...(keyof typeof MENU)[]]),
    confirm: CONFIRM,
  },
  outputSchema: {
    pid: z.number(),
    command: z.string(),
    commandId: z.number(),
    posted: z.boolean(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const status = (await callSidecar("hammer_live", { action: "status" }, ctx.config, 30_000)) as {
      editors: Array<{ pid: number; mainWindow: number }>;
    };
    const editor = args.pid
      ? status.editors.find((e) => e.pid === args.pid)
      : status.editors.find((e) => e.mainWindow);
    if (!editor) throw new Error("no running editor window; run hammer_status");
    const commandId = MENU[args.command as keyof typeof MENU];
    const reply = (await callSidecar(
      "hammer_live",
      { action: "menu", pid: editor.pid, commandId },
      ctx.config,
      30_000,
    )) as { posted: boolean; reason?: string };
    return {
      pid: editor.pid,
      command: args.command,
      commandId,
      posted: reply.posted,
      note: reply.posted
        ? "Posted to the editor's main window. Dialogs open without blocking the caller."
        : (reply.reason ?? "the editor refused the menu command"),
    };
  },
});

export const hammerLiveTools = [hammerStatusTool, hammerLiveEditTool, hammerMenuTool];
