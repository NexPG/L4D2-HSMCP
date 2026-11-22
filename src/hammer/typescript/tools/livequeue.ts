/**
 * The human-in-the-loop half of live Hammer edits: stage, review, apply, and read the
 * journal. The transport and address rules are the ones `hammer_live_edit` already uses;
 * this file adds a durable queue so an edit can be proposed, read, approved and only then
 * sent to the editor.
 *
 * Staging and review work with Hammer closed: they only read the saved VMF and the journal.
 * Applying is the step that needs a running editor, and only an entry in `approved` can be
 * applied. `review_live_edit` requires `confirm`, which is the same human gate every other
 * guarded tool uses; the MCP client is responsible for showing the entry to the person.
 */
import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { CONFIRM, resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import {
  assertEditorMap,
  checkLiveAddresses,
  OP,
  resolveLiveEditor,
  saveLiveEditor,
  sendLiveCommands,
  shellCommandsFor,
} from "./hammerlive.js";
import {
  appendJournal,
  buildLiveState,
  buildQueueState,
  captureBefore,
  latestJournalEntry,
  nextJournalId,
  readJournal,
} from "../live/journal.js";
import type { LiveEntity, LiveJournalEntry } from "../live/journal.js";

const ENTITY = z.object({
  classname: z.string(),
  origin: z.array(z.number()),
  keyvalues: z.record(z.string(), z.string()),
});

const STATE = z.enum(["staged", "approved", "rejected", "applied", "failed"]);

const ENTRY = z.object({
  id: z.string(),
  pid: z.number(),
  vmf: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  state: STATE,
  ops: z.array(OP),
  save: z.boolean(),
  commands: z.array(z.string()),
  before: z.array(ENTITY.nullable()),
  note: z.string().optional(),
  reason: z.string().optional(),
  accepted: z.number().optional(),
  rejected: z.number().optional(),
  results: z
    .array(z.object({ accepted: z.boolean(), command: z.string() }))
    .optional(),
  saved: z.boolean().optional(),
  appliedAt: z.string().optional(),
});

function journalContext(
  stateDir: string,
  pid: number,
  vmf: string,
): LiveJournalEntry[] {
  return readJournal(stateDir).filter((entry) => entry.pid === pid && entry.vmf === vmf);
}

function validationRefusal(
  stateDir: string,
  pid: number,
  vmf: string,
  ops: LiveJournalEntry["ops"],
  includePending = true,
  excludeId?: string,
): string | null {
  const text = readFileSync(vmf, "utf8");
  const entries = journalContext(stateDir, pid, vmf).filter(
    (entry) => entry.id !== excludeId,
  );
  const state = includePending
    ? buildQueueState(text, entries, statSync(vmf).mtimeMs)
    : buildLiveState(text, entries, statSync(vmf).mtimeMs);
  return checkLiveAddresses(text, ops, state);
}

export const stageLiveEditTool = defineTool({
  name: "stage_live_edit",
  description:
    "Proposes a live Hammer edit without sending it. Validates the class+origin addresses " +
    "against the saved VMF and earlier applied edits (so an entity created in a previous " +
    "call can be addressed before a save), records the commands and the before-state, and " +
    "returns a `live-NNNN` id. Nothing reaches Hammer. `pid` comes from hammer_status; the " +
    "editor may be closed while the queue waits. Review with `review_live_edit`, then send " +
    "with `apply_live_edit`.",
  realm: "local",
  inputSchema: {
    pid: z.number().int().positive().describe("Editor process id from hammer_status."),
    vmf: z.string().describe("Saved VMF open in that editor, absolute or repo-relative."),
    ops: z.array(OP).min(1),
    save: z.boolean().default(false).describe("Run Hammer's Save after the applied edits."),
    note: z.string().optional().describe("Reason or context for the reviewer."),
  },
  outputSchema: {
    id: z.string(),
    state: z.literal("staged"),
    pid: z.number(),
    vmf: z.string(),
    commands: z.array(z.string()),
    before: z.array(ENTITY.nullable()),
    note: z.string().optional(),
  },
  handler: (args, ctx) => {
    const vmf = resolveVmfInput(args.vmf, ctx.config);
    const text = readFileSync(vmf, "utf8");
    const entries = readJournal(ctx.config.stateDir);
    const state = buildQueueState(
      text,
      entries.filter((entry) => entry.pid === args.pid && entry.vmf === vmf),
      statSync(vmf).mtimeMs,
    );
    const refusal = checkLiveAddresses(text, args.ops, state);
    if (refusal) throw new Error(refusal);
    const now = new Date().toISOString();
    const id = nextJournalId(entries);
    const entry: LiveJournalEntry = {
      id,
      pid: args.pid,
      vmf,
      createdAt: now,
      updatedAt: now,
      state: "staged",
      ops: args.ops,
      save: args.save,
      commands: args.ops.flatMap(shellCommandsFor),
      before: captureBefore(state, args.ops),
      ...(args.note ? { note: args.note } : {}),
    };
    appendJournal(ctx.config.stateDir, entry);
    ctx.audit.record({
      kind: "live_edit_staged",
      data: { id, pid: args.pid, vmf, ops: args.ops.length },
    });
    return {
      id,
      state: "staged" as const,
      pid: args.pid,
      vmf,
      commands: entry.commands,
      before: entry.before,
      ...(entry.note ? { note: entry.note } : {}),
    };
  },
});

export const reviewLiveEditTool = defineTool({
  name: "review_live_edit",
  description:
    "Approves or rejects a staged live edit; an approved edit can still be rejected (cancelled) " +
    "before it is applied. Approval re-validates the class+origin addresses " +
    "against the current saved VMF and journal, so an edit approved against a changed map is " +
    "refused rather than sent. This is a human decision: the tool is guarded and needs " +
    "`confirm`, and the MCP client should show the staged commands and before-state to the " +
    "person. Nothing reaches Hammer.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    id: z.string().regex(/^live-\d+$/).describe("Queue id from stage_live_edit."),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().optional().describe("Why, for the journal."),
    confirm: CONFIRM,
  },
  outputSchema: {
    id: z.string(),
    state: STATE,
    reason: z.string().optional(),
  },
  handler: (args, ctx) => {
    const entries = readJournal(ctx.config.stateDir);
    const entry = latestJournalEntry(entries, args.id);
    if (!entry) throw new Error(`no staged edit ${args.id}; read_edit_journal lists the queue`);
    if (entry.state === "applied" || entry.state === "failed" || entry.state === "rejected") {
      throw new Error(`edit ${args.id} is ${entry.state}; it is no longer reviewable`);
    }
    if (entry.state === "approved" && args.decision === "approve") {
      throw new Error(`edit ${args.id} is already approved; apply it or reject it`);
    }
    if (args.decision === "approve") {
      const refusal = validationRefusal(
        ctx.config.stateDir,
        entry.pid,
        entry.vmf,
        entry.ops,
        true,
        entry.id,
      );
      if (refusal) throw new Error(`approval refused: ${refusal}`);
    }
    const state = args.decision === "approve" ? "approved" : "rejected";
    appendJournal(ctx.config.stateDir, {
      ...entry,
      state,
      updatedAt: new Date().toISOString(),
      ...(args.reason ? { reason: args.reason } : {}),
    });
    ctx.audit.record({
      kind: state === "approved" ? "live_edit_approved" : "live_edit_rejected",
      data: { id: entry.id, pid: entry.pid, vmf: entry.vmf },
    });
    return { id: entry.id, state, ...(args.reason ? { reason: args.reason } : {}) };
  },
});

export const applyLiveEditTool = defineTool({
  name: "apply_live_edit",
  description:
    "Sends an approved live edit to Hammer through the shell channel. Re-validates the " +
    "class+origin addresses first; if the map changed since approval, the entry is marked " +
    "failed instead of being sent. Applies in one batch, optionally posts Save, and records " +
    "accepted/rejected results and the before-state in the journal. Only `approved` entries " +
    "can be applied. Guarded.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    id: z.string().regex(/^live-\d+$/).describe("Approved queue id."),
    confirm: CONFIRM,
  },
  outputSchema: {
    id: z.string(),
    state: STATE,
    pid: z.number(),
    vmf: z.string(),
    accepted: z.number(),
    rejected: z.number(),
    results: z.array(z.object({ accepted: z.boolean(), command: z.string() })),
    saved: z.boolean(),
    reason: z.string().optional(),
  },
  handler: async (args, ctx) => {
    const entries = readJournal(ctx.config.stateDir);
    const entry = latestJournalEntry(entries, args.id);
    if (!entry) throw new Error(`no edit ${args.id}; read_edit_journal lists the queue`);
    if (entry.state !== "approved") {
      throw new Error(`edit ${args.id} is ${entry.state}, not approved; review it first`);
    }
    const refusal = validationRefusal(ctx.config.stateDir, entry.pid, entry.vmf, entry.ops, false);
    if (refusal) {
      const reason = `the map changed since approval: ${refusal}`;
      appendJournal(ctx.config.stateDir, {
        ...entry,
        state: "failed",
        updatedAt: new Date().toISOString(),
        reason,
      });
      ctx.audit.record({ kind: "live_edit_failed", data: { id: entry.id, reason } });
      throw new Error(reason);
    }

    const editor = await resolveLiveEditor(ctx, entry.pid);
    assertEditorMap(editor, entry.vmf);
    const reply = await sendLiveCommands(ctx, editor.pid, entry.vmf, entry.commands);
    if (!reply.session) {
      const reason = reply.reason ?? "Hammer refused the edit session";
      appendJournal(ctx.config.stateDir, {
        ...entry,
        state: "failed",
        updatedAt: new Date().toISOString(),
        reason,
      });
      ctx.audit.record({ kind: "live_edit_failed", data: { id: entry.id, reason } });
      throw new Error(reason);
    }
    const saved = entry.save ? await saveLiveEditor(ctx, editor.pid) : false;
    const failed = reply.accepted === 0 && entry.commands.length > 0;
    const state = failed ? "failed" : "applied";
    const now = new Date().toISOString();
    const reason = failed ? "the editor rejected every command" : undefined;
    appendJournal(ctx.config.stateDir, {
      ...entry,
      state,
      updatedAt: now,
      ...(state === "applied" ? { appliedAt: now } : {}),
      accepted: reply.accepted,
      rejected: reply.rejected,
      results: reply.results,
      saved,
      ...(reason ? { reason } : {}),
    });
    ctx.audit.record({
      kind: state === "applied" ? "live_edit_applied" : "live_edit_failed",
      data: { id: entry.id, pid: editor.pid, accepted: reply.accepted, rejected: reply.rejected },
    });
    return {
      id: entry.id,
      state,
      pid: editor.pid,
      vmf: entry.vmf,
      accepted: reply.accepted,
      rejected: reply.rejected,
      results: reply.results,
      saved,
      ...(reason ? { reason } : {}),
    };
  },
});

export const readEditJournalTool = defineTool({
  name: "read_edit_journal",
  description:
    "Lists live-edit journal entries newest first: staged, approved, rejected, applied and " +
    "failed. Each entry carries the ops, the exact shell commands, the before-state of every " +
    "addressed entity and, once applied, accepted/rejected results. Filter by state, editor " +
    "pid, VMF or id. This is the approval queue (`state: \"staged\"`) and the history of what " +
    "reached Hammer. Read-only.",
  realm: "local",
  inputSchema: {
    id: z.string().optional().describe("One queue id."),
    state: STATE.optional(),
    pid: z.number().int().positive().optional(),
    vmf: z.string().optional().describe("Match the recorded VMF path."),
    limit: z.number().int().min(1).max(500).optional().describe("Default 50."),
  },
  outputSchema: {
    count: z.number(),
    entries: z.array(ENTRY),
  },
  handler: (args, ctx) => {
    const vmf = args.vmf ? resolveVmfInput(args.vmf, ctx.config) : undefined;
    const entries = readJournal(ctx.config.stateDir)
      .filter((entry) => (args.id ? entry.id === args.id : true))
      .filter((entry) => (args.state ? entry.state === args.state : true))
      .filter((entry) => (args.pid ? entry.pid === args.pid : true))
      .filter((entry) => (vmf ? entry.vmf === vmf : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, args.limit ?? 50);
    return {
      count: entries.length,
      entries: entries as Array<LiveJournalEntry & { before: Array<LiveEntity | null> }>,
    };
  },
});

export const liveQueueTools = [
  stageLiveEditTool,
  reviewLiveEditTool,
  applyLiveEditTool,
  readEditJournalTool,
];
