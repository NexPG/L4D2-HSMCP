import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runInputTool } from "../../src/hammer/typescript/tools/input.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

describe("run_input", () => {
  it("refuses a process that is not running before it tries to send input", async () => {
    await expect(
      runInputTool.handler(
        {
          process: "hsmcp_no_such_process_xyz",
          keys: "e",
          repeat: 1,
          intervalMs: 10,
          waitMs: 0,
          focus: true,
          confirm: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/no running process/);
  });
});
