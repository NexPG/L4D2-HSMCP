/**
 * Running the editor's Run Map sequence.
 *
 * The dry-run cases pin the variable vocabulary (`$path`, `$file`, `$gamedir`, `$bspdir`)
 * and the two deliberate refusals: the game is not launched and an arbitrary executable is
 * not run. The execution cases use file steps, which are fast and observable, plus one real
 * vbsp run so a wrong `$path\$file` cannot pass as "planned".
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runCompileSequenceTool } from "../../src/maps/typescript/tools/sequences.js";
import { ctx as sharedCtx, FIXTURES, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const made: string[] = [];
const probe = join(FIXTURES, "hmcp_probe.vmf");

afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hsmcp-seqrun-"));
  made.push(dir);
  return dir;
}

interface KvCommand {
  enable?: string;
  specialcmd?: string;
  run?: string;
  parms?: string;
  ensure_check?: string;
  ensure_fn?: string;
}

/** Writes the Hammer++ KeyValues form with one sequence. */
function writeSequence(dir: string, name: string, commands: KvCommand[]): string {
  const lines = ['"Command Sequences"', "{", `\t"${name}"`, "\t{"];
  commands.forEach((command, index) => {
    lines.push(`\t\t"${index}"`, "\t\t{");
    for (const [key, value] of Object.entries(command)) {
      if (value !== undefined) lines.push(`\t\t\t"${key}"\t\t"${value}"`);
    }
    lines.push("\t\t}");
  });
  lines.push("\t}", "}", "");
  const path = join(dir, `sequence-${name.replace(/\W+/g, "-")}.cfg`);
  writeFileSync(path, lines.join("\n"), "utf8");
  return path;
}

type RunReply = {
  ok: boolean;
  complete: boolean;
  dryRun: boolean;
  stoppedAt: number | null;
  notes: string[];
  bspExists: boolean;
  bspBytes: number | null;
  commands: Array<{
    kind: string;
    stage: string;
    status: string;
    note: string | null;
    resolved: {
      executable: string | null;
      args: string[];
      source: string | null;
      destination: string | null;
    };
  }>;
};

describe.skipIf(
  !has.sidecar || !has.gameContent || (!has.toolchain && !has.plusplus),
)("run_compile_sequence dry run", () => {
  it("resolves the editor's variables and skips the game launch", async () => {
    const dir = scratchDir();
    const file = writeSequence(dir, "Dry", [
      { enable: "1", specialcmd: "0", run: "$bsp_exe", parms: "-game $gamedir $path\\$file" },
      {
        enable: "1",
        specialcmd: "257",
        parms: "$path\\$file.bsp $bspdir\\$file.bsp",
      },
      { enable: "1", specialcmd: "0", run: "$game_exe", parms: "-game $gamedir +map $file" },
    ]);

    const r = (await runCompileSequenceTool.handler(
      { vmf: probe, sequence: "Dry", file, dryRun: true, game: undefined, limit: 0 } as never,
      ctx,
    )) as RunReply;

    expect(r.dryRun).toBe(true);
    expect(r.ok).toBe(true);
    // The game step is deliberately skipped, so this is not a complete reproduction.
    expect(r.complete).toBe(false);
    const [bsp, copy, game] = r.commands;
    expect(bsp!.status).toBe("planned");
    expect(bsp!.stage).toBe("vbsp");
    expect(bsp!.resolved.executable?.toLowerCase()).toMatch(/vbsp(\+\+|plusplus)?\.exe$/);
    expect(bsp!.resolved.args.slice(0, 2)).toEqual(["-game", expect.stringMatching(/left4dead2/i)]);
    expect(bsp!.resolved.args.some((arg) => arg.endsWith("hmcp_probe"))).toBe(true);

    expect(copy!.kind).toBe("copy-file");
    expect(copy!.resolved.destination).toMatch(/left4dead2[\\/]maps[\\/]hmcp_probe\.bsp$/i);

    expect(game!.status).toBe("skipped");
    expect(game!.note).toMatch(/does not launch the game/);
    expect(r.notes.join(" ")).toMatch(/\$bspdir/);
  });

  it("refuses an unknown variable before running anything", async () => {
    const dir = scratchDir();
    const file = writeSequence(dir, "Unknown", [
      { enable: "1", specialcmd: "0", run: "$bsp_exe", parms: "-game $gamedir $nope" },
    ]);
    await expect(
      runCompileSequenceTool.handler(
        { vmf: probe, sequence: "Unknown", file, dryRun: true, game: undefined } as never,
        ctx,
      ),
    ).rejects.toThrow(/unknown \$nope/);
  });

  it("refuses an executable that is not a compiler alias", async () => {
    const dir = scratchDir();
    const file = writeSequence(dir, "Custom", [
      { enable: "1", specialcmd: "0", run: "C:\\tools\\post.exe", parms: "run" },
    ]);
    const r = (await runCompileSequenceTool.handler(
      { vmf: probe, sequence: "Custom", file, dryRun: true, game: undefined } as never,
      ctx,
    )) as RunReply;
    expect(r.commands[0]!.status).toBe("skipped");
    expect(r.commands[0]!.note).toMatch(/refuses to execute an arbitrary path/);
  });
});

describe.skipIf(!has.sidecar)("run_compile_sequence file steps", () => {
  it("copies, renames and deletes, and reports a conditional copy that did nothing", async () => {
    const dir = scratchDir();
    const source = join(dir, "xx.txt");
    const copied = join(dir, "yy.txt");
    const renamed = join(dir, "zz.txt");
    const missing = join(dir, "qq.txt");
    const missingDest = join(dir, "ww.txt");
    writeFileSync(source, "payload", "utf8");

    const file = writeSequence(dir, "Files", [
      { enable: "1", specialcmd: "257", parms: `${source} ${copied}` },
      { enable: "1", specialcmd: "259", parms: `${copied} ${renamed}` },
      { enable: "1", specialcmd: "258", parms: `${renamed}` },
      { enable: "1", specialcmd: "261", parms: `${missing} ${missingDest}` },
    ]);

    const r = (await runCompileSequenceTool.handler(
      { vmf: probe, sequence: "Files", file, confirm: true, game: undefined } as never,
      ctx,
    )) as RunReply;

    expect(r.ok).toBe(true);
    expect(r.stoppedAt).toBeNull();
    expect(r.commands.map((command) => command.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "skipped",
    ]);
    expect(r.commands[3]!.note).toMatch(/does not exist/);
    expect(r.complete).toBe(false);
    expect(existsSync(copied)).toBe(false);
    expect(existsSync(renamed)).toBe(false);
    expect(existsSync(missingDest)).toBe(false);
  });

  it("fails a step whose ensured file is absent and stops there", async () => {
    const dir = scratchDir();
    const source = join(dir, "xx.txt");
    const copied = join(dir, "yy.txt");
    writeFileSync(source, "payload", "utf8");
    const file = writeSequence(dir, "Ensure", [
      {
        enable: "1",
        specialcmd: "257",
        parms: `${source} ${copied}`,
        ensure_check: "1",
        ensure_fn: join(dir, "xx-absent.txt"),
      },
      { enable: "1", specialcmd: "258", parms: `${copied}` },
    ]);

    const r = (await runCompileSequenceTool.handler(
      { vmf: probe, sequence: "Ensure", file, confirm: true, game: undefined } as never,
      ctx,
    )) as RunReply;

    expect(r.ok).toBe(false);
    expect(r.stoppedAt).toBe(0);
    expect(r.commands[0]!.status).toBe("failed");
    expect(r.commands[0]!.note).toMatch(/ensure_check failed/);
    // The delete step never ran, so the copy is still there.
    expect(existsSync(copied)).toBe(true);
  });

  it("refuses to execute without confirm", async () => {
    const dir = scratchDir();
    const source = join(dir, "xx.txt");
    writeFileSync(source, "payload", "utf8");
    const file = writeSequence(dir, "NeedsConfirm", [
      { enable: "1", specialcmd: "257", parms: `${source} ${join(dir, "yy.txt")}` },
    ]);
    await expect(
      runCompileSequenceTool.handler(
        { vmf: probe, sequence: "NeedsConfirm", file, game: undefined } as never,
        ctx,
      ),
    ).rejects.toThrow(/confirm: true/);
  });
});

describe.skipIf(!has.toolchain || !has.sidecar)("run_compile_sequence with the real vbsp", () => {
  it("compiles the sealed probe through $bsp_exe and $path\\$file", async () => {
    const dir = scratchDir();
    const vmf = join(dir, "seq_probe.vmf");
    copyFileSync(probe, vmf);
    const file = writeSequence(dir, "Build", [
      { enable: "1", specialcmd: "0", run: "$bsp_exe", parms: "-game $gamedir $path\\$file" },
    ]);

    const r = (await runCompileSequenceTool.handler(
      {
        vmf,
        sequence: "Build",
        file,
        confirm: true,
        timeoutMinutes: 10,
        game: undefined,
      } as never,
      ctx,
    )) as RunReply;

    expect(r.ok).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.commands[0]!.status).toBe("ok");
    expect(r.bspExists).toBe(true);
    expect(r.bspBytes).toBeGreaterThan(0);
  }, 120_000);
});
