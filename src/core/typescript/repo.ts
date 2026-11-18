import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The directory that holds `package.json`, found by walking up from this module.
 *
 * Two callers used to count directory levels: `version.ts` read `../package.json`, the sidecar
 * client built `../../sidecar/main.py`, and `health` walked two levels to the build root. Every
 * one of those numbers was a fact about where the module happened to sit, and moving a file
 * into a module directory silently broke all three at once — `health` reported a missing
 * version, the sidecar could not be found, and nothing said why.
 *
 * Walking up to the marker is the same amount of code and cannot be broken by a move.
 */
export function packageRoot(from: URL | string = import.meta.url): string {
  let dir = dirname(typeof from === "string" ? fileURLToPath(from) : fileURLToPath(from));
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`package.json not found above ${fileURLToPath(from)}`);
}
