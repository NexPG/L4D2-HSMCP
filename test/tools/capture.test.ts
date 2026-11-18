import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { captureWindowTool } from "../../src/hammer/typescript/tools/capture.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

describe("capture_window", () => {
  it("requires a process id or name", async () => {
    await expect(captureWindowTool.handler({}, ctx)).rejects.toThrow(/processId or processName/);
  });

  it("says when no process matches the name", async () => {
    await expect(
      captureWindowTool.handler({ processName: "definitely_not_running_9f3a", confirm: true }, ctx),
    ).rejects.toThrow(/no running process matches/);
  });
});
