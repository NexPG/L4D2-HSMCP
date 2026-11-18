/**
 * Hammer's Run Map sequences: what the editor itself does when someone presses F9.
 *
 * `run_compile` runs vbsp, vvis and vrad with the flags this project chooses. The user's
 * editor may be told to do something else — `-StaticPropLighting`, a different `-Game`, a
 * copy step, a `ChangeDirectory` — and none of that was visible to an agent. Reading the
 * sequences closes that: the agent can say what the editor would actually run, and a
 * difference between the two is a fact instead of a mystery.
 *
 * Three formats exist and all three are read:
 *
 * * `CmdSeq.wc` — Worldcraft / Hammer 3.x / 4.x. A text header, a float version, then
 *   804-byte commands. The layout is from EpicMorg/Hammer-MCP `Compile/CompileSequences.cs`
 *   (MIT, Copyright (c) 2026 EpicMorg), which is the only reference that documents it;
 * * `hammerplusplus_sequences.cfg` — KeyValues, one block per numbered command;
 * * `cmdseq.wc` from Strata — the same KeyValues with `special_cmd` and escaped backslashes.
 *
 * A disabled command is still listed: "the Copy File step is unchecked" is exactly the kind
 * of thing that makes a compile produce nothing while reporting success.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { get, parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";

export type CompileCommandKind =
  | "run"
  | "change-directory"
  | "copy-file"
  | "delete-file"
  | "rename-file";

export interface CompileCommand {
  enabled: boolean;
  special: number;
  kind: CompileCommandKind;
  run: string;
  parameters: string;
  /** `ensure_check`: skip the step when its output is already newer. */
  ensureCheck: boolean;
  ensureFile: string | null;
  useProcessWindow: boolean;
  noWait: boolean;
}

export interface CompileSequence {
  name: string;
  commands: CompileCommand[];
}

export type CompileSequenceFormat = "cmdseq-binary" | "keyvalues";

export interface CompileSequenceFile {
  path: string;
  format: CompileSequenceFormat;
  sequences: CompileSequence[];
}

const BINARY_HEADER = "Worldcraft Command Sequences\r\n\u001a";
/** One command record in the binary format. */
const COMMAND_BYTES = 804;

const SPECIAL_KINDS: Record<number, CompileCommandKind> = {
  0: "run",
  256: "change-directory",
  257: "copy-file",
  258: "delete-file",
  259: "rename-file",
};

function kindOf(special: number): CompileCommandKind {
  return SPECIAL_KINDS[special] ?? "run";
}

/** NUL-terminated fixed-width string, tolerant of a field with no terminator. */
function fixedString(bytes: Buffer, offset: number, length: number): string {
  const end = bytes.indexOf(0, offset);
  const limit = Math.min(offset + length, bytes.length);
  const stop = end === -1 || end > limit ? limit : end;
  return bytes.toString("latin1", offset, stop);
}

/** Parses a binary `CmdSeq.wc`. Returns null when the header is not the one this reads. */
export function parseCmdSeqBinary(bytes: Buffer, path = "<buffer>"): CompileSequence[] | null {
  if (bytes.length < BINARY_HEADER.length + 8) return null;
  if (bytes.toString("latin1", 0, BINARY_HEADER.length) !== BINARY_HEADER) return null;

  // The float version (0.2) does not branch anything: every file in the wild is 0.2, and a
  // file whose records do not fit is reported below rather than half-read.
  const count = bytes.readInt32LE(BINARY_HEADER.length + 4);
  let offset = BINARY_HEADER.length + 8;
  const sequences: CompileSequence[] = [];

  for (let s = 0; s < count && offset + 132 <= bytes.length; s += 1) {
    const name = fixedString(bytes, offset, 128);
    const commandCount = bytes.readInt32LE(offset + 128);
    offset += 132;

    // Check the whole block before reading any of it: a reader that stops at the first
    // record that does not fit returns a sequence that looks truncated at the end rather
    // than one that says the file is wrong.
    if (commandCount < 0 || offset + commandCount * COMMAND_BYTES > bytes.length) {
      throw new Error(
        `${path}: sequence "${name}" declares ${commandCount} commands, which need ` +
          `${commandCount * COMMAND_BYTES} bytes past offset ${offset} in a ${bytes.length}-byte file`,
      );
    }

    const commands: CompileCommand[] = [];
    for (let c = 0; c < commandCount && offset + COMMAND_BYTES <= bytes.length; c += 1) {
      const special = bytes.readInt32LE(offset + 4);
      commands.push({
        enabled: bytes.readInt32LE(offset) !== 0,
        special,
        kind: kindOf(special),
        run: fixedString(bytes, offset + 8, 260),
        parameters: fixedString(bytes, offset + 268, 260),
        ensureCheck: bytes.readInt32LE(offset + 528) !== 0,
        ensureFile: fixedString(bytes, offset + 532, 260) || null,
        useProcessWindow: bytes.readInt32LE(offset + 796) !== 0,
        noWait: bytes.readInt32LE(offset + 800) !== 0,
      });
      offset += COMMAND_BYTES;
    }
    sequences.push({ name, commands });
  }

  if (sequences.length !== count) {
    throw new Error(
      `${path}: the file declares ${count} sequences but only ${sequences.length} fit in ` +
        `${bytes.length} bytes; the record layout differs from the 804-byte one this reader knows`,
    );
  }
  return sequences;
}

/**
 * Parses `hammerplusplus_sequences.cfg` and Strata's `cmdseq.wc`.
 *
 * Hammer++ writes `parms`, Strata writes `params`; Strata escapes backslashes (`$path\\$file`)
 * while Hammer++ does not, and the engine wants one backslash either way.
 */
export function parseCmdSeqText(source: string, path = "<text>"): CompileSequence[] {
  const sequences: CompileSequence[] = [];

  for (const sequence of parse(source)) {
    if (sequence.kind !== "block") continue;
    const commands: CompileCommand[] = [];
    const blocks = sequence.entries.filter((entry): entry is KvBlock => entry.kind === "block");
    // The commands are numbered; a file that numbers them 10, 2, 1 means 1, 2, 10.
    for (const command of [...blocks].sort((a, b) => Number(a.name) - Number(b.name))) {
      const read = (...keys: string[]): string => {
        for (const key of keys) {
          const value = get(command, key);
          if (value !== undefined) return value.replace(/\\\\/g, "\\");
        }
        return "";
      };
      const special = Number.parseInt(read("specialcmd", "special_cmd"), 10);
      commands.push({
        enabled: read("enable", "enabled") !== "0",
        special: Number.isFinite(special) ? special : 0,
        kind: kindOf(Number.isFinite(special) ? special : 0),
        run: read("run"),
        parameters: read("parms", "params"),
        ensureCheck: read("ensure_check", "ensurecheck") === "1",
        ensureFile: read("ensure_fn", "ensurefile") || null,
        useProcessWindow: read("use_process_wnd", "useprocwnd") !== "0",
        noWait: read("no_wait", "nowait") === "1",
      });
    }
    sequences.push({ name: sequence.name, commands });
  }

  if (sequences.length === 0) {
    throw new Error(`${path}: no sequences found; a Hammer++ file has one block per sequence`);
  }
  return sequences;
}

/** Reads either format, deciding from the first bytes rather than the file name. */
export function loadCompileSequences(path: string): CompileSequenceFile {
  const bytes = readFileSync(path);
  const binary = parseCmdSeqBinary(bytes, path);
  if (binary !== null) return { path, format: "cmdseq-binary", sequences: binary };
  return { path, format: "keyvalues", sequences: parseCmdSeqText(bytes.toString("utf8"), path) };
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
