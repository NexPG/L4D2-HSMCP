import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

describe("run_studiomdl", () => {
  it("refuses a missing QC before touching the game", async () => {
    await expect(
      runStudiomdlTool.handler(
        { qc: "test/fixtures/no_such_model.qc", timeoutMinutes: 1, confirm: true },
        ctx,
      ),
    ).rejects.toThrow(/does not exist/);
  });

  it("refuses a file that is not a QC", async () => {
    await expect(
      runStudiomdlTool.handler(
        { qc: "test/fixtures/hmcp_probe.vmf", timeoutMinutes: 1, confirm: true },
        ctx,
      ),
    ).rejects.toThrow(/is not a \.qc/);
  });
});
