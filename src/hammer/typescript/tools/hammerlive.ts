/**
 * Live Hammer / Hammer++ tools.
 *
 * Portions ported from Hammer-MCP (https://github.com/EpicMorg/Hammer-MCP),
 * MIT License, Copyright (c) 2026 EpicMorg. The shell-channel command and menu ids are
 * adapted to this project's tool contracts. The full notice is in third_party/NOTICES.md.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import type { ToolContext } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { readEntities } from "../../../maps/typescript/vmf/edit.js";
import {
  appendJournal,
  buildLiveState,
  captureBefore,
  liveAddressKey,
  nextJournalId,
  parseLiveOrigin,
  readJournal,
} from "../live/journal.js";
import type { LiveEntity } from "../live/journal.js";

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

export const OP = z.discriminatedUnion("op", [
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

/**
 * Why the shell channel's address cannot be used, or null when it is unambiguous.
 *
 * The channel has no entity ids: every command is `class + origin`. That is only a
 * selector when exactly one entity is there, so the same check the upstream tool makes is
 * made here before anything reaches the editor: a create must land on an empty address,
 * and an edit must land on exactly one entity. The count covers the saved `.vmf` plus the
 * ops earlier in this same call (create/delete), because nothing is saved between them.
 *
 * What it cannot see is an unsaved edit someone made in Hammer since the last save. That
 * is reported in the tool's description; the check is a guard against the common mistake,
 * not a substitute for the editor's own state.
 */
export function checkLiveAddresses(
  vmfText: string,
  ops: readonly z.infer<typeof OP>[],
  overlay?: ReadonlyMap<string, LiveEntity>,
): string | null {
  const counts = new Map<string, number>();
  if (overlay) {
    for (const key of overlay.keys()) counts.set(key, 1);
  } else {
    for (const entity of readEntities(vmfText).entities) {
      const origin = parseLiveOrigin(entity.keyvalues.origin);
      if (!origin) continue;
      const key = liveAddressKey(entity.classname, origin);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const [index, op] of ops.entries()) {
    const key = liveAddressKey(op.classname, op.origin);
    const count = counts.get(key) ?? 0;
    const at = `${op.classname} at ${op.origin.join(" ")}`;
    if (op.op === "create" && count > 0) {
      return (
        `op ${index + 1}: ${count} ${at} already exist(s); the channel addresses by ` +
        "class + origin, so a second one could not be selected afterwards. Use other " +
        "coordinates or edit the VMF."
      );
    }
    if (op.op !== "create" && count === 0) {
      return (
        `op ${index + 1}: no ${at} in the saved map or in this call's earlier ops; ` +
        "save the map in Hammer first and check the origin."
      );
    }
    if (op.op !== "create" && count > 1) {
      return (
        `op ${index + 1}: ${count} ${at} share the origin; the channel can only address ` +
        "class + origin and cannot choose which one. Move or rename one, or edit the VMF."
      );
    }
    if (op.op === "create") counts.set(key, count + 1);
    else if (op.op === "delete") counts.set(key, count - 1);
  }
  return null;
}

export interface LiveEditor {
  pid: number;
  hasShell: boolean;
  openMap: string | null;
}

/**
 * The editor a live command is aimed at: an explicit pid, or the first shell-capable one.
 * Shared by the direct edit and the approval queue, so both name the same window.
 */
export async function resolveLiveEditor(
  ctx: Pick<ToolContext, "config">,
  pid?: number,
): Promise<LiveEditor> {
  const status = (await callSidecar(
    "hammer_live",
    { action: "status" },
    ctx.config,
    30_000,
  )) as { editors: LiveEditor[] };
  const editor = pid
    ? status.editors.find((e) => e.pid === pid)
    : status.editors.find((e) => e.hasShell);
  if (!editor) {
    throw new Error(
      pid
        ? `no editor with pid ${pid}; run hammer_status`
        : "no running Hammer with a shell channel; open a map in Hammer++ first",
    );
  }
  if (!editor.hasShell) {
    throw new Error(
      `editor ${editor.pid} has no shell channel. Hammer++ 8867+ and stock Hammer have ` +
        "one; this build does not. Writing the VMF is still available.",
    );
  }
  return editor;
}

/** Refuses a pid whose title says it has a different map open. */
export function assertEditorMap(editor: LiveEditor, vmf: string): void {
  if (!editor.openMap) return;
  const norm = (path: string): string => resolve(path).replace(/\//g, "\\").toLowerCase();
  if (norm(editor.openMap) === norm(vmf)) return;
  throw new Error(
    `editor ${editor.pid} has ${editor.openMap} open, not ${vmf}; refusing to send the edit ` +
      "to the wrong map",
  );
}

export interface LiveBatchReply {
  session: boolean;
  acceptedVersion?: number;
  accepted: number;
  rejected: number;
  results: Array<{ accepted: boolean; command: string }>;
  reason?: string;
}

export async function sendLiveCommands(
  ctx: Pick<ToolContext, "config">,
  pid: number,
  vmf: string,
  commands: readonly string[],
): Promise<LiveBatchReply> {
  return (await callSidecar(
    "hammer_live",
    { action: "batch", pid, vmf, commands },
    ctx.config,
    120_000,
  )) as LiveBatchReply;
}

export async function saveLiveEditor(ctx: Pick<ToolContext, "config">, pid: number): Promise<boolean> {
  const reply = (await callSidecar(
    "hammer_live",
    { action: "menu", pid, commandId: MENU.save },
    ctx.config,
    30_000,
  )) as { posted: boolean };
  return reply.posted;
}

export const hammerLiveEditTool = defineTool({
  name: "hammer_live_edit",
  description:
    "Edits the map that is open in Hammer / Hammer++ through the editor's shell channel: " +
    "create a point entity (and set its keyvalues), set a keyvalue, delete an entity, or " +
    "rotate it. The channel addresses entities by class + origin, so the saved VMF is read " +
    "first and an ambiguous address is refused: a create must land where no entity of that " +
    "class sits, and an edit must land on exactly one. Create, delete and rotate are in " +
    "Hammer's undo history; a keyvalue change is not, so read the old value first. The " +
    "channel cannot create brushes or move entities, and stock Hammer's rotate applies to " +
    "entities with a model (prop_*), not to a bare info_target. `vmf` must be the saved map " +
    "open in the editor; it is read for the address check and used to open the shell " +
    "session. `save: true` runs Hammer's Save command afterwards, which is what makes the " +
    "change visible to the file readers. Guarded.",
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
    const editor = await resolveLiveEditor(ctx, args.pid);
    const vmf = resolveVmfInput(args.vmf, ctx.config);
    assertEditorMap(editor, vmf);
    const beforeText = readFileSync(vmf, "utf8");
    const journal = readJournal(ctx.config.stateDir).filter(
      (entry) => entry.pid === editor.pid && entry.vmf === vmf,
    );
    const state = buildLiveState(beforeText, journal, statSync(vmf).mtimeMs);
    const refusal = checkLiveAddresses(beforeText, args.ops, state);
    if (refusal) throw new Error(refusal);
    const commands = args.ops.flatMap(shellCommandsFor);
    const reply = await sendLiveCommands(ctx, editor.pid, vmf, commands);
    if (!reply.session) {
      throw new Error(reply.reason ?? "Hammer refused the edit session");
    }
    const saved = args.save ? await saveLiveEditor(ctx, editor.pid) : false;
    const now = new Date().toISOString();
    appendJournal(ctx.config.stateDir, {
      id: nextJournalId(readJournal(ctx.config.stateDir)),
      pid: editor.pid,
      vmf,
      createdAt: now,
      updatedAt: now,
      state: reply.accepted === 0 && commands.length > 0 ? "failed" : "applied",
      ops: args.ops,
      save: args.save,
      commands,
      before: captureBefore(state, args.ops),
      accepted: reply.accepted,
      rejected: reply.rejected,
      results: reply.results,
      saved,
      appliedAt: now,
      ...(reply.accepted === 0 && commands.length > 0
        ? { reason: "the editor rejected every command" }
        : {}),
    });
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
        "the class+origin, or the build does not support that command. Create/delete/rotate " +
        "are undoable; a keyvalue change is not. Save is a menu command; if `saved` is " +
        "false the change is only in the editor's memory.",
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
