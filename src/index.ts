#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./core/typescript/config.js";
import { runInstall } from "./core/typescript/install.js";
import { AuditLog } from "./core/typescript/logger.js";
import { sweepWindows } from "./core/typescript/process/windows.js";
import { ToolRegistry } from "./core/typescript/mcp/registry.js";
import type { ToolContext } from "./core/typescript/mcp/registry.js";
import { createMcpServer } from "./core/typescript/mcp/server.js";
import { registerSkillResources } from "./core/typescript/mcp/skill.js";
import { registerSkillPrompts } from "./core/typescript/mcp/prompts.js";

/**
 * Handed to the client at connection time.
 *
 * With tool search, a client no longer loads every tool definition upfront: this prose
 * may be the only thing it reads before deciding whether to look for our tools at all.
 * So it says what the server is FOR and when to reach for it -- not how each tool works,
 * which the tool definitions already carry.
 */
const INSTRUCTIONS = `Offline, local-first tooling for Left 4 Dead 2: maps, campaigns, nav meshes,
VScripts, models, textures, materials, HUD screens, audio, particles and addon VPKs.

Reach for it to read or edit a .vmf, inspect or patch a .bsp, compile through the game's
own toolchain or the editor's Run Map sequence, generate and inspect nav, author and compile
models, write VTF/VMT/particles/audio content, build and verify VPKs, and launch/probe the
game for evidence. Prefer it over reading binary map files by hand: a .bsp is read by offset,
not loaded whole.

Realms: \`map\` is pure file work, \`local\` shells out to a host binary. Tools that write
or execute are guarded and take confirm:true. It never talks to a running game or a
dedicated server and holds no lock.

The L4D2-HSMCP skill is served as MCP resources under \`l4d2-hsmcp://skill/\`: start with
\`l4d2-hsmcp://skill/SKILL.md\`, then the workflow or reference it names. The same routes
are MCP prompts (\`l4d2_task\`, \`l4d2_hud_override\`, \`l4d2_material_edit\`,
\`l4d2_compiled_light\`, \`l4d2_editor_sequence\`).`;
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
    name: "l4d2-hsmcp",
    version: VERSION,
    instructions: INSTRUCTIONS,
  });
  const skillRoot = join(import.meta.dirname, "..", "skill", "l4d2-hsmcp");
  const skillCount = existsSync(skillRoot) ? registerSkillResources(server, skillRoot) : 0;
  const promptCount = registerSkillPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `l4d2-hsmcp ${VERSION} ready -- repoRoot=${config.repoRoot} ` +
      `platform=${process.platform} tools=${registry.list().length} ` +
      `skillResources=${skillCount} prompts=${promptCount}\n`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`l4d2-hsmcp: failed to start -- ${message}\n`);
  process.exit(1);
});
