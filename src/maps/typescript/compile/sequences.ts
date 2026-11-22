/**
 * Where the editors keep their Run Map sequences.
 *
 * The file format — Valve's binary `CmdSeq.wc`, Hammer++'s KeyValues and Strata's
 * KeyValues — belongs to `srctools.cmdseq` and is read through the sidecar verb
 * `cmdseq_read`. This file only knows the four places an editor may have put the file,
 * which is a fact about Hammer's installation, not about the format.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
