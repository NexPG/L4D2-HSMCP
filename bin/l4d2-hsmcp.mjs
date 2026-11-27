/**
 * Starts the built MCP server from anywhere.
 *
 * The package entry (`dist/index.js`) resolves its skill directory relative to itself, and
 * the server resolves its repository root from the caller's working directory or
 * `L4D2_HSMCP_REPO`. This launcher only finds that built entry from its own location, so
 * `node bin/l4d2-hsmcp.mjs` works from the repository root, from `src/` and from an
 * installed package; it does not change the working directory or the caller's project.
 *
 * `opencode.json` uses this file because OpenCode resolves a local MCP command against the
 * session directory; the config's bootstrap finds the file, sets `L4D2_HSMCP_REPO`, and
 * imports it. The package's `bin` entry points here too, so a global install uses the same
 * path. Build first: `pnpm build`.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "dist", "index.js");

if (!existsSync(entry)) {
  console.error(`l4d2-hsmcp: ${entry} is missing. Run "pnpm build" in ${root} first.`);
  process.exit(1);
}

await import(pathToFileURL(entry).href);
