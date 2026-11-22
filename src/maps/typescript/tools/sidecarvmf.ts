/**
 * The one route for a map edit whose work is done by a Python sidecar verb.
 *
 * `collapse_instances`, `carve_solids` and `hull_solids` all have the same shape: the
 * sidecar reads the map, writes a complete new VMF to a scratch path, and the TypeScript
 * side applies this repository's guarded write to the caller's `out`. They had three
 * copies of the temp directory, the sidecar call, the overwrite check and the two counts;
 * a fourth tool would have made a fourth copy. The only parts that belong to a tool are
 * its verb, its parameters and its optional validation of the result.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../../../core/typescript/config.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import type { GuardedWrite } from "../../../core/typescript/fs/write.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";
import { checkVmfSolids } from "../vmf/solid.js";

export interface SidecarVmfRequest<T> {
  config: Config;
  /** The sidecar verb, e.g. `vmf_collapse`. */
  verb: string;
  path: string;
  out: string;
  /** Extra verb parameters. `path` and `out` are added by the helper. */
  params?: Record<string, unknown>;
  overwrite?: boolean;
  dryRun?: boolean;
  backup?: boolean;
  timeoutMs?: number;
  /** Prefix for the temporary directory, so a stuck call is identifiable. */
  label?: string;
  /** Runs before the guarded write; throw to refuse the result. */
  validate?: (text: string, reply: T) => void;
}

export interface SidecarVmfResult<T> {
  text: string;
  reply: T;
  write: GuardedWrite;
  solidCount: number;
  entityCount: number;
}

/** Solids and `entity` blocks in a VMF, through the readers already used elsewhere. */
export function countVmf(text: string, path = ""): { solidCount: number; entityCount: number } {
  const roots = parse(text).filter((node): node is KvBlock => node.kind === "block");
  return {
    solidCount: checkVmfSolids(path, text).solidCount,
    entityCount: roots.filter((block) => block.name === "entity").length,
  };
}

export async function runSidecarVmf<T>(request: SidecarVmfRequest<T>): Promise<SidecarVmfResult<T>> {
  const {
    config,
    verb,
    path,
    out,
    params = {},
    overwrite,
    dryRun,
    backup,
    timeoutMs = 300_000,
    label = verb,
    validate,
  } = request;
  if (out !== path && existsSync(out) && !overwrite && !dryRun) {
    throw new Error(`${out} already exists; pass overwrite:true to replace it`);
  }
  const scratch = mkdtempSync(join(tmpdir(), `hammer-${label}-`));
  const tempOut = join(scratch, "result.vmf");
  try {
    const reply = (await callSidecar(
      verb,
      { path, out: tempOut, ...params },
      config,
      timeoutMs,
    )) as T;
    const text = readFileSync(tempOut, "utf8");
    validate?.(text, reply);
    const write = writeGuarded(out, text, config, {
      dryRun,
      backup,
      unchanged: false,
    });
    return { text, reply, write, ...countVmf(text, path) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
