/**
 * Run Map sequences: the editor's own compile steps.
 *
 * The binary format is the one worth testing carefully, because it is undocumented outside
 * Hammer-MCP and a reader that is one field out still returns plausible strings. The fixture
 * is written record by record at the offsets the format uses (enabled at 0, special at 4,
 * the executable at 8, parameters at 268, the two flags at 796 and 800), so a reader that
 * drifts is caught by the values rather than by a length check.
 *
 * The text form has its own trap: Hammer++ writes `parms`, Strata writes `params`, and Strata
 * escapes backslashes. A compiler path that arrives with doubled separators does not run.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  candidateSequenceFiles,
  findSequenceFile,
  loadCompileSequences,
  parseCmdSeqBinary,
  parseCmdSeqText,
} from "../../src/maps/typescript/compile/sequences.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readCompileSequencesTool } from "../../src/maps/typescript/tools/sequences.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-seq-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const HEADER = "Worldcraft Command Sequences\r\n\u001a";

function writeFixed(buffer: Buffer, offset: number, text: string, length: number): void {
  buffer.write(text, offset, Math.min(text.length, length - 1), "latin1");
}

/** One sequence with two commands, laid out exactly as the 804-byte format expects. */
function binaryFixture(): Buffer {
  const command = Buffer.alloc(804);
  command.writeInt32LE(1, 0);
  command.writeInt32LE(0, 4);
  writeFixed(command, 8, "vbsp.exe", 260);
  writeFixed(command, 268, "-game left4dead2 -StaticPropLighting", 260);
  command.writeInt32LE(0, 528);
  command.writeInt32LE(1, 796);
  command.writeInt32LE(1, 800);

  const copy = Buffer.alloc(804);
  copy.writeInt32LE(0, 0); // disabled
  copy.writeInt32LE(257, 4); // copy-file
  writeFixed(copy, 8, "custom.bsp", 260);
  writeFixed(copy, 268, "B:\\maps\\custom.bsp", 260);
  copy.writeInt32LE(1, 528);
  writeFixed(copy, 532, "custom.bsp", 260);

  const name = Buffer.alloc(128);
  writeFixed(name, 0, "Full compile - Final", 128);

  const head = Buffer.alloc(HEADER.length + 8);
  head.write(HEADER, 0, "latin1");
  head.writeFloatLE(0.2, HEADER.length);
  head.writeInt32LE(1, HEADER.length + 4);

  const count = Buffer.alloc(4);
  count.writeInt32LE(2, 0);
  return Buffer.concat([head, name, count, command, copy]);
}

describe("compile sequences", () => {
  it("reads the binary CmdSeq.wc at its real field offsets", () => {
    const sequences = parseCmdSeqBinary(binaryFixture(), "CmdSeq.wc")!;
    expect(sequences).toHaveLength(1);
    const [sequence] = sequences;
    expect(sequence!.name).toBe("Full compile - Final");
    expect(sequence!.commands).toHaveLength(2);
    expect(sequence!.commands[0]).toMatchObject({
      enabled: true,
      kind: "run",
      run: "vbsp.exe",
      parameters: "-game left4dead2 -StaticPropLighting",
      useProcessWindow: true,
      noWait: true,
    });
    expect(sequence!.commands[1]).toMatchObject({
      enabled: false,
      kind: "copy-file",
      run: "custom.bsp",
      parameters: "B:\\maps\\custom.bsp",
      ensureCheck: true,
      ensureFile: "custom.bsp",
    });
  });

  it("refuses a binary file whose records do not fit instead of reading half of it", () => {
    const truncated = binaryFixture().subarray(0, 200);
    expect(() => parseCmdSeqBinary(truncated, "short.wc")).toThrow(/declares 2 commands/);
    expect(parseCmdSeqBinary(Buffer.from("not a sequence file"), "x")).toBeNull();
  });

  it("reads the KeyValues form, with Strata's spelling and escaping", () => {
    const source = String.raw`"Normal"
{
	"0"
	{
		"enabled" "1"
		"special_cmd" "0"
		"run" "$bsp_exe"
		"params" "-game $gamedir $path\$file"
		"ensure_check" "0"
		"ensure_fn" ""
		"use_process_wnd" "1"
		"no_wait" "0"
	}
	"1"
	{
		"enabled" "0"
		"specialcmd" "258"
		"run" "old.bsp"
		"parms" "old.bsp"
	}
	"2"
	{
		"enabled" "1"
		"specialcmd" "0"
		"run" "vvis.exe"
		"parms" "-game $gamedir"
	}
}
`;
    const sequences = parseCmdSeqText(source, "hammerplusplus_sequences.cfg");
    expect(sequences).toHaveLength(1);
    const commands = sequences[0]!.commands;
    // Numbered blocks are ordered by their number, not by their position in the file.
    expect(commands.map((c) => c.run)).toEqual(["$bsp_exe", "old.bsp", "vvis.exe"]);
    expect(commands[0]!.parameters).toBe("-game $gamedir $path\\$file");
    expect(commands[1]).toMatchObject({ enabled: false, kind: "delete-file", special: 258 });
    expect(commands[2]!.enabled).toBe(true);
  });

  it("finds the file next to an editor, in the order the editors use", () => {
    const exeDir = join(scratch, "bin");
    mkdirSync(join(exeDir, "hammerplusplus"), { recursive: true });
    writeFileSync(join(exeDir, "hammerplusplus", "hammerplusplus_sequences.cfg"), '"Normal"\n{\n"0"\n{\n"run" "vbsp.exe"\n}\n}\n');
    expect(findSequenceFile(exeDir)).toBe(join(exeDir, "hammerplusplus", "hammerplusplus_sequences.cfg"));
    expect(candidateSequenceFiles(exeDir)).toHaveLength(4);

    const loaded = loadCompileSequences(findSequenceFile(exeDir)!);
    expect(loaded.format).toBe("keyvalues");
    expect(loaded.sequences[0]!.commands[0]!.run).toBe("vbsp.exe");
  });

  it("reports what the editor would run, and which steps it would skip", async () => {
    const file = join(scratch, "CmdSeq.wc");
    writeFileSync(file, binaryFixture());

    const r = (await readCompileSequencesTool.handler({ file }, ctx)) as {
      found: boolean;
      format: string;
      sequences: Array<{
        name: string;
        enabledCount: number;
        commands: Array<{ stage: string; enabled: boolean; parameters: string }>;
      }>;
    };

    expect(r.found).toBe(true);
    expect(r.format).toBe("cmdseq-binary");
    expect(r.sequences[0]!.name).toBe("Full compile - Final");
    expect(r.sequences[0]!.enabledCount).toBe(1);
    expect(r.sequences[0]!.commands.map((c) => c.stage)).toEqual(["vbsp", "other"]);
    expect(r.sequences[0]!.commands[0]!.parameters).toContain("-StaticPropLighting");
    expect(r.sequences[0]!.commands[1]!.enabled).toBe(false);
  });

  it("says no sequence file was found rather than returning an empty success", async () => {
    const r = (await readCompileSequencesTool.handler(
      { exeDir: join(scratch, "no-editor-here", "bin") },
      ctx,
    )) as { found: boolean; detail: string; candidates: string[] };
    expect(r.found).toBe(false);
    expect(r.detail).toMatch(/No Run Map sequence file/);
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});
