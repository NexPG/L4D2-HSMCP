import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Config } from "../config.js";

/**
 * Trees this server must never write into, relative to the repo root.
 *
 * `srcds/` is a SteamCMD-managed game tree: a `validate` or a branch change replaces
 * files under it, so anything of ours living there is lost without warning. Everything
 * that belongs to us goes to a working directory instead, and is deployed into place
 * deliberately. `reference/` is a read-only corpus.
 *
 * An editor hook can enforce this for the Edit/Write *tools* -- it cannot see `node:fs`
 * calls made inside an MCP server. So this is discipline, not enforcement, and
 * `assertWritable` is the choke point that makes it auditable.
 *
 * That last sentence used to end "every write in this codebase goes through it", which was
 * not true and had no test able to say so: the contract test inspected each tool's default
 * output path, and the four VMF geometry writers have none -- the path is always the
 * caller's -- so it found nothing to object to while they called `writeFileSync` directly.
 * File edits now go through `./write.ts`, and a contract test calls each writer for real on
 * a map inside `srcds/` and requires it to refuse.
 */
export const FORBIDDEN_TREES = ["srcds", "reference"] as const;

export class WriteRefused extends Error {
  constructor(
    readonly path: string,
    readonly tree: string,
  ) {
    super(
      `refusing to write ${path}: it resolves under ${tree}/, which this server never ` +
        `writes to. Write to a working directory instead, and deploy deliberately.`,
    );
    this.name = "WriteRefused";
  }
}

/**
 * Resolves a path through symlinks as far as it exists.
 *
 * A plain `resolve()` is not enough: addon directories are often symlinks into another
 * tree, so a lexically innocent path can still land inside the SteamCMD tree.
 * The target file usually does not exist yet, so we resolve the nearest existing
 * ancestor and re-append the rest.
 */
function realResolve(path: string): string {
  const abs = resolve(path);
  let dir = abs;
  const tail: string[] = [];
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) return abs;
    tail.unshift(dir.slice(parent.length + 1));
    dir = parent;
  }
  return [realpathSync(dir), ...tail].join(sep);
}

/** True when `child` is `parent` itself or sits underneath it. */
function isUnder(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Throws unless `path` may be written. Call this before every write, without exception --
 * including writes whose path the caller supplied and which look obviously fine.
 *
 * Returns the symlink-resolved absolute path, so callers write to what was actually
 * checked rather than to the string they were handed.
 */
export function assertWritable(path: string, config: Config): string {
  const target = realResolve(path);
  const root = realResolve(config.repoRoot);

  for (const tree of FORBIDDEN_TREES) {
    if (isUnder(target, resolve(root, tree))) throw new WriteRefused(target, tree);
  }
  return target;
}
