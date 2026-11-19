#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./core/typescript/config.js";
import { runInstall } from "./core/typescript/install.js";
import { AuditLog } from "./core/typescript/logger.js";
import { sweepWindows } from "./core/typescript/process/windows.js";
import { ToolRegistry } from "./core/typescript/mcp/registry.js";
import type { ToolContext } from "./core/typescript/mcp/registry.js";
import { createMcpServer } from "./core/typescript/mcp/server.js";

/**
 * Handed to the client at connection time.
 *
 * With tool search, a client no longer loads every tool definition upfront: this prose
 * may be the only thing it reads before deciding whether to look for our tools at all.
 * So it says what the server is FOR and when to reach for it -- not how each tool works,
 * which the tool definitions already carry.
 */
const INSTRUCTIONS = `Offline map tooling for Left 4 Dead 2.

Reach for it to: measure a map (extents, entity counts and histogram, lump sizes) --
including a 1 GB shipped .bsp, which it reads by offset in milliseconds rather than
loading whole; inspect or edit a .vmf; and drive the Windows compilers natively, with the
game's own FGD as the entity schema.

Prefer it over reading map files by hand: a .bsp is binary, and a naive full read of a
large map would stall this transport.

Realms: \`map\` is pure file work, \`local\` shells out to a host binary. Tools that write
or execute are guarded and take confirm:true. It never talks to a running game or a
dedicated server and holds no lock.`;
import { allTools } from "./registry.js";
import { preapprove } from "./core/typescript/mcp/preapprove.js";
import { VERSION } from "./core/typescript/version.js";

/**
 * Entry point of the l4d2-hsmcp MCP server (stdio transport, local-first).
 *
 * Offline file tooling for Left 4 Dead 2 maps: VMF, BSP and the Windows compilers,
 * natively. It holds no lock and opens no transport into a running game; anything that
 * needs the live engine belongs to a separate bridge.
 *
 * Launched by Claude Code, so nothing may go to stdout: that is the protocol channel.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  if (process.argv[2] === "install") {
    runInstall(config);
    return;
  }

  const audit = new AuditLog(config.stateDir);
  // A previous run can leave an HLMV or Hammer behind when the server is stopped mid-call.
  // The ledger is written before the launch and cleared only after a verified close.
  const swept = await sweepWindows(config.stateDir);
  if (swept.length > 0) {
    audit.record({ kind: "process_kill", data: { pids: swept, reason: "startup sweep" } });
  }
  audit.record({
    kind: "server_start",
    data: { version: VERSION, repoRoot: config.repoRoot, platform: process.platform },
  });

  const registry = new ToolRegistry();
  // `toolAllowlist` lifts both of a guarded tool's gates, not just ours -- see
  // `src/mcp/preapprove.ts`. Applied here rather than inside the registry because it is a
  // property of this deployment's configuration, not of the tools.
  registry.registerAll(preapprove(allTools, config.toolAllowlist));

  const ctx: ToolContext = { config, audit, registry };
  const server = createMcpServer(registry, ctx, {
    name: "hammer-mcp",
    version: VERSION,
    instructions: INSTRUCTIONS,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `hammer-mcp ${VERSION} ready -- repoRoot=${config.repoRoot} ` +
      `platform=${process.platform} tools=${registry.list().length}\n`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`hammer-mcp: failed to start -- ${message}\n`);
  process.exit(1);
});
