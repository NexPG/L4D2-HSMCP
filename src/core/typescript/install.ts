import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installProject as coreInstall, installReport } from "@projectsociety/mcp-core";
import type { Config } from "./config.js";

/**
 * Absolute path to the launcher, resolved from this module.
 *
 * `bin/l4d2-hsmcp.mjs` finds `dist/index.js` from its own location, so the installed entry
 * keeps working when the checkout moves and does not depend on the working directory.
 * Computing it here and not in `@projectsociety/mcp-core` is deliberate: resolving `./index.js`
 * against the shared package would point at mcp-core's own dist.
 */
function serverEntry(): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  return join(root, "bin", "l4d2-hsmcp.mjs");
}

function spec(config: Config) {
  return {
    serverName: "l4d2-hsmcp",
    envVar: "L4D2_HSMCP_REPO",
    repoRoot: config.repoRoot,
    entryPath: serverEntry(),
  };
}

/**
 * Merges the l4d2-hsmcp entry into `<repoRoot>/.mcp.json` (project scope, committed and
 * shared). Other declared servers -- gmod-mcp above all -- are preserved.
 */
export function installProject(config: Config): { path: string; entry: unknown } {
  return coreInstall(spec(config));
}

/** Entry point of the `l4d2-hsmcp install` subcommand. */
export function runInstall(config: Config): void {
  const s = spec(config);
  const { path } = coreInstall(s);
  process.stdout.write(
    installReport(s, path, [
      "",
      "Build first: (pnpm install && pnpm build) in the repository root",
    ]),
  );
}
