/**
 * Run Map sequences: the editor's own compile steps.
 *
 * The format is `srctools.cmdseq`'s, and these tests are written against the real field
 * offsets: after the two 260-byte strings comes the long-filename flag at 528, the
 * ensure-check flag at 532 and the ensured path at 536. The fixture used to place the
 * ensured path at 532, four bytes early, which is why the old TypeScript reader passed its
 * own test while disagreeing with both srctools and SourcePP.
 *
 * The text form has two traps of its own: the root block is `"Command Sequences"`, and
 * Strata escapes backslashes (`$path\\$file`) while Hammer++ does not. A compiler path that
 * arrives with doubled separators does not run.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  candidateSequenceFiles,
  findSequenceFile,
} from "../../src/maps/typescript/compile/sequences.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readCompileSequencesTool } from "../../src/maps/typescript/tools/sequences.js";
import { ctx as sharedCtx, has } from "../support/env.js";

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
  command.writeInt32LE(1, 528); // long filename
  command.writeInt32LE(0, 532); // no ensure check
  command.writeInt32LE(1, 796);
  command.writeInt32LE(1, 800);

  const copy = Buffer.alloc(804);
  copy.writeInt32LE(0, 0); // disabled
  copy.writeInt32LE(257, 4); // copy-file
  writeFixed(copy, 8, "Copy File", 260);
  writeFixed(copy, 268, "B:\\maps\\custom.bsp C:\\maps\\custom.bsp", 260);
  copy.writeInt32LE(1, 528); // long filename
  copy.writeInt32LE(1, 532); // ensure check
  writeFixed(copy, 536, "custom.bsp", 260);

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

function textFixture(): string {
  return String.raw`"Command Sequences"
{
	"Normal"
	{
		"2"
		{
			"enabled" "1"
			"special_cmd" "0"
			"run" "$bsp_exe"
			"params" "-game $gamedir $path\\$file"
		}
		"0"
		{
			"enabled" "0"
			"specialcmd" "258"
			"parms" "old.bsp"
		}
		"1"
		{
			"enabled" "1"
			"special_cmd" "copy_file_if_exists"
			"params" "$path\\$file.bsp $bspdir\\$file.bsp"
		}
	}
}
`;
}

describe("compile sequence discovery", () => {
  it("finds the file next to an editor, in the order the editors use", () => {
    const exeDir = join(scratch, "bin");
    mkdirSync(join(exeDir, "hammerplusplus"), { recursive: true });
    writeFileSync(
      join(exeDir, "hammerplusplus", "hammerplusplus_sequences.cfg"),
      '"Command Sequences"\n{\n}\n',
    );
    expect(findSequenceFile(exeDir)).toBe(
      join(exeDir, "hammerplusplus", "hammerplusplus_sequences.cfg"),
    );
    expect(candidateSequenceFiles(exeDir)).toHaveLength(4);
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

describe.skipIf(!has.sidecar)("compile sequences through srctools", () => {
  it("reads the binary CmdSeq.wc at its real field offsets", async () => {
    const file = join(scratch, "CmdSeq.wc");
    writeFileSync(file, binaryFixture());
    const r = (await readCompileSequencesTool.handler({ file }, ctx)) as {
      found: boolean;
      format: string;
      sequences: Array<{
        name: string;
        enabledCount: number;
        commands: Array<{
          enabled: boolean;
          special: number;
          kind: string;
          executable: string | null;
          run: string;
          parameters: string;
          ensureCheck: boolean;
          ensureFile: string | null;
          useProcessWindow: boolean;
          noWait: boolean;
          stage: string;
        }>;
      }>;
    };

    expect(r.found).toBe(true);
    expect(r.format).toBe("cmdseq-binary");
    const sequence = r.sequences[0]!;
    expect(sequence.name).toBe("Full compile - Final");
    expect(sequence.enabledCount).toBe(1);
    expect(sequence.commands[0]).toMatchObject({
      enabled: true,
      special: 0,
      kind: "run",
      executable: "vbsp.exe",
      run: "vbsp.exe",
      parameters: "-game left4dead2 -StaticPropLighting",
      ensureCheck: false,
      ensureFile: null,
      useProcessWindow: true,
      noWait: true,
      stage: "vbsp",
    });
    expect(sequence.commands[1]).toMatchObject({
      enabled: false,
      special: 257,
      kind: "copy-file",
      executable: null,
      run: "Copy File",
      parameters: "B:\\maps\\custom.bsp C:\\maps\\custom.bsp",
      ensureCheck: true,
      ensureFile: "custom.bsp",
      stage: "other",
    });
  });

  it("refuses a binary file whose records do not fit instead of reading half of it", async () => {
    const file = join(scratch, "short.wc");
    writeFileSync(file, binaryFixture().subarray(0, 200));
    await expect(readCompileSequencesTool.handler({ file }, ctx)).rejects.toThrow();
  });

  it("reads the KeyValues form, with its root, spelling and escaping", async () => {
    const file = join(scratch, "hammerplusplus_sequences.cfg");
    writeFileSync(file, textFixture());
    const r = (await readCompileSequencesTool.handler({ file }, ctx)) as {
      format: string;
      sequences: Array<{
        name: string;
        commands: Array<{
          enabled: boolean;
          special: number;
          kind: string;
          run: string;
          parameters: string;
        }>;
      }>;
    };

    expect(r.format).toBe("keyvalues");
    expect(r.sequences).toHaveLength(1);
    expect(r.sequences[0]!.name).toBe("Normal");
    const commands = r.sequences[0]!.commands;
    // Numbered blocks are ordered by their number, not by their position in the file.
    expect(commands.map((c) => c.kind)).toEqual([
      "delete-file",
      "copy-file-if-exists",
      "run",
    ]);
    expect(commands[0]).toMatchObject({
      enabled: false,
      special: 258,
      run: "Delete File",
      parameters: "old.bsp",
    });
    expect(commands[1]).toMatchObject({ special: 261, run: "Copy File if it Exists" });
    expect(commands[1]!.parameters).toBe("$path\\$file.bsp $bspdir\\$file.bsp");
    expect(commands[2]!.parameters).toBe("-game $gamedir $path\\$file");
  });

  it("reads the game's own CmdSeqDefault.wc when it is installed", async () => {
    const binDir = ctx.config.binDir;
    const file = binDir ? join(binDir, "CmdSeqDefault.wc") : "";
    const present = file !== "" && existsSync(file);
    if (!present) return;
    const r = (await readCompileSequencesTool.handler({ file }, ctx)) as {
      format: string;
      sequences: Array<{
        name: string;
        commands: Array<{ kind: string; run: string; parameters: string }>;
      }>;
    };
    expect(r.format).toBe("cmdseq-binary");
    const sequence = r.sequences.find((s) => s.name === "Default")!;
    expect(sequence.commands[0]!.run).toBe("$bsp_exe");
    expect(sequence.commands[0]!.parameters).toContain("$gamedir");
    expect(sequence.commands.some((c) => c.kind === "copy-file")).toBe(true);
  });
});
