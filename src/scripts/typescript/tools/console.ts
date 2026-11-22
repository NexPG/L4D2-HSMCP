/**
 * `send_console_command`: a console command in a running Source game.
 *
 * The transport is the sidecar's `send_console_command`, which calls
 * `srctools.run.send_engine_command`; that is the `WM_COPYDATA` message to the `Valve001`
 * window the engine's own `-hijack` path uses. It is deliberately not synthetic keys: the
 * game does not have to be foreground, and the console decides whether the command is legal.
 *
 * Guarded because a console command can quit the server, change a cvar or load a map.
 */
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM } from "../../../core/typescript/tools/paths.js";

export const sendConsoleCommandTool = defineTool({
  name: "send_console_command",
  description:
    "Runs a console command in a running Source game through the engine's `WM_COPYDATA` " +
    "channel (`Valve001`), the same path `-hijack` uses. No synthetic keys and no focus: the " +
    "game can be in the background. Separate several commands with `;`. Fails with the window " +
    "class when no game is running, so a silent no-op cannot look like success. Guarded: a " +
    "command can quit the server, change a cvar or load a map.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    command: z
      .string()
      .min(1)
      .describe("Console command, or several separated by `;`, e.g. `status` or `echo ready`."),
    classname: z
      .string()
      .min(1)
      .default("Valve001")
      .describe("Window class to send to. L4D2 and the other Source branches use Valve001."),
    confirm: CONFIRM,
  },
  outputSchema: {
    command: z.string(),
    classname: z.string(),
    sent: z.boolean(),
  },
  handler: async (args, ctx) => {
    if (args.command.trim().length === 0) {
      throw new Error("command is empty; a console command needs at least one character");
    }
    const reply = (await callSidecar(
      "send_console_command",
      { command: args.command, classname: args.classname },
      ctx.config,
      30_000,
    )) as { command: string; classname: string; sent: boolean };
    return reply;
  },
});

export const consoleTools = [sendConsoleCommandTool];
