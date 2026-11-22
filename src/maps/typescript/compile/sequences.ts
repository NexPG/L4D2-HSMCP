/**
 * The editor's Run Map sequences: where they live, how to read them, and what their
 * `$variables` mean.
 *
 * The file format — Valve's binary `CmdSeq.wc`, Hammer++'s KeyValues and Strata's
 * KeyValues — belongs to `srctools.cmdseq` and is read through the sidecar verb
 * `cmdseq_read`. The candidate locations are a fact about Hammer's installation; the
 * variable names are Hammer's compile vocabulary.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Config } from "../../../core/typescript/config.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { splitWindowsArgs } from "./commandline.js";

export type CmdSeqKind =
  | "run"
  | "change-directory"
  | "copy-file"
  | "delete-file"
  | "rename-file"
  | "copy-file-if-exists";

export interface CmdSeqCommand {
  enabled: boolean;
  special: number;
  kind: CmdSeqKind;
  /** Null for a special step, which has no executable of its own. */
  executable: string | null;
  /** The executable, or the special step's display name ("Copy File"). */
  run: string;
  parameters: string;
  ensureCheck: boolean;
  ensureFile: string | null;
  useProcessWindow: boolean;
  noWait: boolean;
}

export interface CmdSeqSequence {
  name: string;
  commands: CmdSeqCommand[];
}

export interface CmdSeqFile {
  path: string;
  format: "cmdseq-binary" | "keyvalues";
  sequences: CmdSeqSequence[];
}

/** Reads a sequence file through `srctools.cmdseq`. */
export async function readSequenceFile(config: Config, path: string): Promise<CmdSeqFile> {
  return callSidecar<CmdSeqFile>("cmdseq_read", { path }, config, 60_000);
}

/** Where the editors keep their sequences, in the order they are checked. */
export function candidateSequenceFiles(exeDir: string): string[] {
  return [
    join(exeDir, "hammerplusplus", "hammerplusplus_sequences.cfg"),
    join(exeDir, "CmdSeq.wc"),
    join(dirname(exeDir), "CmdSeq.wc"),
    join(dirname(dirname(exeDir)), "hammer", "cfg", "cmdseq.wc"),
  ];
}

/** The first candidate that exists, or null. */
export function findSequenceFile(exeDir: string): string | null {
  for (const candidate of candidateSequenceFiles(exeDir)) {
    if (existsSync(candidate)) return resolve(candidate);
  }
  return null;
}

/** Candidates for the configured editors, or for one explicit directory. */
export function sequenceCandidates(config: Config, exeDir?: string): string[] {
  if (exeDir) return candidateSequenceFiles(exeDir);
  return [
    ...(config.plusPlusBinDir ? candidateSequenceFiles(config.plusPlusBinDir) : []),
    ...(config.binDir ? candidateSequenceFiles(config.binDir) : []),
  ];
}

/** The first configured candidate that exists, or null. */
export function findConfiguredSequenceFile(config: Config, exeDir?: string): string | null {
  return sequenceCandidates(config, exeDir).find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * The values Hammer substitutes into a command.
 *
 * `$bspdir` is the one not read from the editor's own settings: it is `<gameDir>/maps`,
 * the directory the engine loads maps from. Hammer++ records a `BSPDir` in
 * `hammerplusplus_gameconfig.txt`, which a mapper may point elsewhere; this runner says so
 * when a Copy File step uses it rather than pretending it read the editor's setting.
 */
export interface SequenceVariables {
  path: string;
  file: string;
  gamedir: string;
  bspdir: string;
  bsp_exe: string;
  vis_exe: string;
  light_exe: string;
  game_exe: string;
}

export interface Substitution {
  text: string;
  /** The `$names` this map does not know, without duplicates, in first-seen order. */
  unknown: string[];
}

/** Replaces `$name` case-insensitively. Unknown names are reported, not emptied. */
export function substituteSequenceVariables(
  text: string,
  variables: Readonly<Record<string, string>>,
): Substitution {
  const unknown: string[] = [];
  const lowered = new Map(
    Object.entries(variables).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const result = text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name: string) => {
    const value = lowered.get(name.toLowerCase());
    if (value === undefined) {
      if (!unknown.includes(whole)) unknown.push(whole);
      return whole;
    }
    return value;
  });
  return { text: result, unknown };
}

export interface SubstitutedArgs {
  args: string[];
  unknown: string[];
}

/**
 * Splits the editor's parameter string and substitutes each token.
 *
 * The order is load-bearing. `-game $gamedir` must become two arguments even when
 * `$gamedir` is `D:\...\Left 4 Dead 2\left4dead2`; substituting into the whole string first
 * and splitting afterwards turns that path into four. Hammer behaves the same way, which is
 * why the stock sequence needs no quotes around `$gamedir`.
 */
export function substituteSequenceArgs(
  parameters: string,
  variables: Readonly<Record<string, string>>,
): SubstitutedArgs {
  const unknown: string[] = [];
  const args = splitWindowsArgs(parameters).map((token) => {
    const result = substituteSequenceVariables(token, variables);
    for (const name of result.unknown) {
      if (!unknown.includes(name)) unknown.push(name);
    }
    return result.text;
  });
  return { args, unknown };
}
