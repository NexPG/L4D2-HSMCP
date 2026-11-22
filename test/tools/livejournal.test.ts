/**
 * The approval queue and the journal's cross-call addressing. No Hammer is needed for
 * staging or review; applying is tested only for its "no such editor" refusal, because a
 * positive apply needs a live shell channel.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  applyLiveEditTool,
  readEditJournalTool,
  reviewLiveEditTool,
  stageLiveEditTool,
} from "../../src/hammer/typescript/tools/livequeue.js";
import {
  appendJournal,
  buildLiveState,
  nextJournalId,
  readJournal,
} from "../../src/hammer/typescript/live/journal.js";
import { emptyVmf } from "../../src/maps/typescript/vmf/skeleton.js";
import { ctx as sharedCtx } from "../support/env.js";
import { pythonPath } from "../../src/core/typescript/sidecar/client.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-live-queue-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ctx = {
  config: {
    ...sharedCtx.config,
    stateDir: join(scratch, "state"),
    // The state directory holds the sidecar venv by default; the temporary one does not.
    sidecarPython: pythonPath(sharedCtx.config),
  },
  audit: { record: () => undefined },
} as unknown as ToolContext;

function mapWithTarget(origin = "0 0 0"): string {
  return (
    emptyVmf() +
    [
      "entity",
      "{",
      '\t"id" "900"',
      '\t"classname" "info_target"',
      `\t"origin" "${origin}"`,
      '\t"targetname" "existing"',
      "}",
      "",
    ].join("\n")
  );
}

function newMap(name: string, origin = "0 0 0"): string {
  const path = join(scratch, name);
  writeFileSync(path, mapWithTarget(origin));
  return path;
}

interface Staged {
  id: string;
  state: string;
  commands: string[];
  before: unknown[];
}

const stage = async (vmf: string, ops: unknown[], pid = 999_999): Promise<Staged> =>
  stageLiveEditTool.handler({ pid, vmf, ops } as never, ctx) as unknown as Staged;

describe("the live-edit journal", () => {
  it("numbers entries monotonically and ignores damaged lines", () => {
    expect(nextJournalId([])).toBe("live-0001");
    expect(nextJournalId([{ id: "live-0007" } as never])).toBe("live-0008");
    expect(readJournal(join(scratch, "no-such-state"))).toEqual([]);
  });

  it("replays an applied create before the map is saved", () => {
    const vmf = newMap("replay.vmf");
    const text = mapWithTarget();
    appendJournal(ctx.config.stateDir, {
      id: "live-9000",
      pid: 1,
      vmf,
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
      state: "applied",
      ops: [
        {
          op: "create",
          classname: "info_target",
          origin: [128, 0, 0],
          keyvalues: { targetname: "created" },
        },
      ],
      save: false,
      commands: [],
      before: [null],
      appliedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const state = buildLiveState(text, readJournal(ctx.config.stateDir).filter((e) => e.vmf === vmf));
    expect([...state.keys()]).toContain("info_target|128.00 0.00 0.00");
  });

  it("stops replaying once the saved file is newer than the applied entry", () => {
    const vmf = newMap("saved.vmf");
    const text = mapWithTarget();
    const entry = {
      id: "live-9001",
      pid: 1,
      vmf,
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
      state: "applied" as const,
      ops: [{ op: "create" as const, classname: "info_target", origin: [128, 0, 0] }],
      save: false,
      commands: [],
      before: [null],
      appliedAt: new Date(Date.now() - 60_000).toISOString(),
    };
    const state = buildLiveState(text, [entry], Date.now());
    expect([...state.keys()]).not.toContain("info_target|128.00 0.00 0.00");
  });
});

describe("the approval queue", () => {
  it("stages without touching Hammer and reports the exact command", async () => {
    const vmf = newMap("stage.vmf");
    const reply = await stage(vmf, [
      { op: "create", classname: "info_target", origin: [64, 0, 0], keyvalues: { targetname: "new" } },
    ]);
    expect(reply.id).toMatch(/^live-\d+$/);
    expect(reply.state).toBe("staged");
    expect(reply.commands).toEqual([
      "entity_create info_target 64 0 0",
      'entity_set_keyvalue info_target 64 0 0 "targetname" "new"',
    ]);
    const queue = (await readEditJournalTool.handler({ state: "staged" }, ctx)) as unknown as {
      entries: Array<{ id: string }>;
    };
    expect(queue.entries.some((entry) => entry.id === reply.id)).toBe(true);
  });

  it("refuses two pending creates at the same class+origin", async () => {
    const vmf = newMap("pending.vmf");
    await stage(vmf, [{ op: "create", classname: "info_target", origin: [512, 0, 0] }]);
    await expect(
      stage(vmf, [{ op: "create", classname: "info_target", origin: [512, 0, 0] }]),
    ).rejects.toThrow(/already exist/);
  });

  it("refuses a create on an occupied class+origin", async () => {
    const vmf = newMap("occupied.vmf");
    await expect(
      stage(vmf, [{ op: "create", classname: "info_target", origin: [0, 0, 0] }]),
    ).rejects.toThrow(/already exist/);
  });

  it("approves a staged edit and lets a person cancel an approval", async () => {
    const vmf = newMap("review.vmf");
    const staged = await stage(vmf, [
      { op: "setKeyvalue", classname: "info_target", origin: [0, 0, 0], key: "targetname", value: "renamed" },
    ]);
    const approved = (await reviewLiveEditTool.handler(
      { id: staged.id, decision: "approve", confirm: true },
      ctx,
    )) as unknown as { state: string };
    expect(approved.state).toBe("approved");
    await expect(
      async () => reviewLiveEditTool.handler({ id: staged.id, decision: "approve", confirm: true }, ctx),
    ).rejects.toThrow(/already approved/);
    const cancelled = (await reviewLiveEditTool.handler(
      { id: staged.id, decision: "reject", reason: "changed my mind", confirm: true },
      ctx,
    )) as unknown as { state: string };
    expect(cancelled.state).toBe("rejected");
    await expect(
      applyLiveEditTool.handler({ id: staged.id, confirm: true }, ctx),
    ).rejects.toThrow(/not approved/);
  });

  it("approves a staged create on an address that only the entry itself reserves", async () => {
    const vmf = newMap("approve-create.vmf");
    const staged = await stage(vmf, [
      { op: "create", classname: "info_target", origin: [768, 0, 0], keyvalues: { targetname: "queued" } },
    ]);
    const approved = (await reviewLiveEditTool.handler(
      { id: staged.id, decision: "approve", confirm: true },
      ctx,
    )) as unknown as { state: string };
    expect(approved.state).toBe("approved");
  });

  it("rejects without applying", async () => {
    const vmf = newMap("reject.vmf");
    const staged = await stage(vmf, [
      { op: "delete", classname: "info_target", origin: [0, 0, 0] },
    ]);
    const rejected = (await reviewLiveEditTool.handler(
      { id: staged.id, decision: "reject", reason: "not wanted", confirm: true },
      ctx,
    )) as unknown as { state: string };
    expect(rejected.state).toBe("rejected");
    await expect(
      applyLiveEditTool.handler({ id: staged.id, confirm: true }, ctx),
    ).rejects.toThrow(/not approved/);
  });

  it("cannot apply an approved edit when its editor is absent", async () => {
    const vmf = newMap("apply.vmf");
    const staged = await stage(vmf, [
      { op: "setKeyvalue", classname: "info_target", origin: [0, 0, 0], key: "targetname", value: "x" },
    ]);
    await reviewLiveEditTool.handler({ id: staged.id, decision: "approve", confirm: true }, ctx);
    await expect(
      applyLiveEditTool.handler({ id: staged.id, confirm: true }, ctx),
    ).rejects.toThrow(/no editor with pid 999999/);
    const entry = readJournal(ctx.config.stateDir).find((e) => e.id === staged.id);
    expect(entry?.state).toBe("approved");
  });

  it("addresses an entity created by an earlier applied entry", async () => {
    const vmf = newMap("cross-call.vmf");
    appendJournal(ctx.config.stateDir, {
      id: "live-9100",
      pid: 999_999,
      vmf,
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
      state: "applied",
      ops: [
        {
          op: "create",
          classname: "info_target",
          origin: [256, 0, 0],
          keyvalues: { targetname: "earlier" },
        },
      ],
      save: false,
      commands: [],
      before: [null],
      appliedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const edited = await stage(vmf, [
      {
        op: "setKeyvalue",
        classname: "info_target",
        origin: [256, 0, 0],
        key: "targetname",
        value: "edited",
      },
    ]);
    expect(edited.state).toBe("staged");
    await expect(
      stage(vmf, [{ op: "create", classname: "info_target", origin: [256, 0, 0] }]),
    ).rejects.toThrow(/already exist/);
  });

  it("filters the journal by state, pid and id", async () => {
    const vmf = newMap("filter.vmf");
    const staged = await stage(vmf, [
      { op: "delete", classname: "info_target", origin: [0, 0, 0] },
    ], 4242);
    const byId = (await readEditJournalTool.handler({ id: staged.id }, ctx)) as unknown as {
      entries: Array<{ id: string; pid: number }>;
    };
    expect(byId.entries).toHaveLength(1);
    expect(byId.entries[0]!.pid).toBe(4242);
    const none = (await readEditJournalTool.handler({ state: "applied", id: staged.id }, ctx)) as unknown as {
      entries: unknown[];
    };
    expect(none.entries).toEqual([]);
  });
});
