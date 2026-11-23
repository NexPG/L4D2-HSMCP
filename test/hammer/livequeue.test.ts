import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  readEditJournalTool,
  reviewLiveEditTool,
  stageLiveEditTool,
} from "../../src/hammer/typescript/tools/livequeue.js";
import { ctx as sharedEnvCtx, FIXTURES } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hsmcp-livequeue-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// The queue lives in the state dir; point it at the scratch so a test never appends to the
// real journal a person reads.
const base = sharedEnvCtx as unknown as ToolContext;
function contextFor(name: string): ToolContext {
  const stateDir = join(scratch, name, "state");
  mkdirSync(stateDir, { recursive: true });
  return {
    ...base,
    config: { ...base.config, stateDir },
  } as unknown as ToolContext;
}
function mapFor(name: string, ctx: ToolContext): { vmf: string; ctx: ToolContext } {
  const vmf = join(scratch, name, "map.vmf");
  copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), vmf);
  return { vmf, ctx };
}

describe("the live approval queue", () => {
  it("stages an edit without touching the map, then approves it", async () => {
    const ctx = contextFor("approve");
    const { vmf } = mapFor("approve", ctx);

    const staged = (await stageLiveEditTool.handler(
      {
        pid: 4242,
        vmf,
        ops: [{ op: "create", classname: "light", origin: [0, 0, 64] }],
        note: "a light above the spawn",
      } as never,
      ctx,
    )) as { id: string; state: string; commands: string[]; before: unknown[] };
    expect(staged.id).toBe("live-0001");
    expect(staged.state).toBe("staged");
    expect(staged.commands.length).toBeGreaterThan(0);
    expect(staged.before).toHaveLength(1);

    const approved = (await reviewLiveEditTool.handler(
      { id: staged.id, decision: "approve", confirm: true } as never,
      ctx,
    )) as { state: string };
    expect(approved.state).toBe("approved");

    const journal = (await readEditJournalTool.handler({} as never, ctx)) as {
      entries: Array<{ id: string; state: string; note?: string }>;
    };
    expect(journal.entries.find((entry) => entry.id === staged.id)?.state).toBe("approved");

    // Approving twice is a refusal, not a second send.
    expect(() =>
      reviewLiveEditTool.handler({ id: staged.id, decision: "approve", confirm: true } as never, ctx),
    ).toThrow(/already approved/);
  }, 30_000);

  it("refuses an address the saved map does not have", async () => {
    const ctx = contextFor("address");
    const { vmf } = mapFor("address", ctx);
    expect(() =>
      stageLiveEditTool.handler(
        {
          pid: 4242,
          vmf,
          ops: [
            { op: "setKeyvalue", classname: "func_door", origin: [9999, 9999, 9999], key: "speed", value: "100" },
          ],
        } as never,
        ctx,
      ),
    ).toThrow(/no func_door|address/i);
  }, 30_000);

  it("rejects a staged edit and keeps it out of the approved set", async () => {
    const ctx = contextFor("reject");
    const { vmf } = mapFor("reject", ctx);
    const staged = (await stageLiveEditTool.handler(
      {
        pid: 4242,
        vmf,
        ops: [{ op: "create", classname: "light", origin: [64, 0, 64] }],
      } as never,
      ctx,
    )) as { id: string };
    const rejected = (await reviewLiveEditTool.handler(
      { id: staged.id, decision: "reject", reason: "not needed", confirm: true } as never,
      ctx,
    )) as { state: string };
    expect(rejected.state).toBe("rejected");
    expect(() =>
      reviewLiveEditTool.handler({ id: staged.id, decision: "approve", confirm: true } as never, ctx),
    ).toThrow(/no longer reviewable/);
  }, 30_000);
});
