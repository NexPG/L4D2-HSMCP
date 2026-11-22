/**
 * `send_console_command` needs a running Source game for a positive result, so the test
 * checks what can be checked without one: the transport reports a missing window by class
 * instead of pretending it sent, and an empty command is refused before the sidecar.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { sendConsoleCommandTool } from "../../src/scripts/typescript/tools/console.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

describe.skipIf(!has.sidecar)("send_console_command", () => {
  it("refuses an empty command before calling the sidecar", async () => {
    await expect(
      sendConsoleCommandTool.handler({ command: "   ", classname: "Valve001" }, ctx),
    ).rejects.toThrow(/empty/);
  });

  it("names the window class when no game is running", async () => {
    await expect(
      sendConsoleCommandTool.handler(
        { command: "echo hsmcp", classname: "HsmcpNoSuchWindow" },
        ctx,
      ),
    ).rejects.toThrow(/no window with class 'HsmcpNoSuchWindow'/);
  });

  it("surfaces the game's refusal rather than reporting a send", async () => {
    // A classname with no window is the only deterministic failure without a live game.
    let message = "";
    try {
      await sendConsoleCommandTool.handler(
        { command: "quit", classname: "HsmcpNoSuchWindow" },
        ctx,
      );
    } catch (exc) {
      message = exc instanceof Error ? exc.message : String(exc);
    }
    expect(message).toMatch(/is the game running\?/);
  });
});
