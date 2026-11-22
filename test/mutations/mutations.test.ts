/**
 * Left 4 Dead 2 mutations: `modes/<name>.txt` + `scripts/vscripts/<name>.nut`.
 *
 * The tests build an add-on the way the engine expects it and then read both halves back:
 * `srctools.keyvalues` for the mode file and the existing `checkNut` for the Squirrel. The
 * stock `dash` mode is extracted from `pak01_dir.vpk` at test time so the self-base and the
 * compiled `.nuc` case are exercised on Valve's own files, not on a fixture that agrees
 * with this implementation.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runVpkExtractTool } from "../../src/packages/typescript/tools/vpk.js";
import { readVscriptTool } from "../../src/scripts/typescript/tools/vscript.js";
import {
  checkMutationTool,
  readGameModeTool,
  writeMutationTool,
} from "../../src/mutations/typescript/tools/mutations.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-mutation-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface ModeReply {
  name: string;
  filename: string;
  nameMatches: boolean;
  base: string | null;
  baseKind: string;
  maxPlayers: string | null;
  maxPlayerCount: number | null;
  metadata: { displayTitle: string | null; description: string | null; author: string | null };
  convars: Array<{ name: string; value: string }>;
  script: { path: string; compiled: boolean } | null;
  addonInfo: { exists: boolean };
}

const writeAddon = async (
  directory: string,
  over: Record<string, unknown> = {},
): Promise<{ verified: boolean; written: string[]; addonInfoCreated: boolean }> =>
  (await writeMutationTool.handler(
    {
      directory,
      name: "hsmcp_test",
      title: "HSMCP Test Mutation",
      description: "A mutation created by the test suite.",
      author: "tests",
      base: "coop",
      convars: { z_common_limit: 0 },
      directorOptions: { CommonLimit: 0, TankLimit: 2 },
      confirm: true,
      ...over,
    } as never,
    ctx,
  )) as never;

describe.skipIf(!has.sidecar)("mutations", () => {
  it("scaffolds a mode, a MutationOptions script and addoninfo", async () => {
    const directory = join(scratch, "addon");
    const result = await writeAddon(directory);
    expect(result.verified).toBe(true);
    expect(result.addonInfoCreated).toBe(true);
    expect(result.written).toHaveLength(3);
    for (const file of result.written) expect(existsSync(file)).toBe(true);

    const mode = (await readGameModeTool.handler(
      { path: join(directory, "modes", "hsmcp_test.txt") },
      ctx,
    )) as unknown as ModeReply;
    expect(mode.name).toBe("hsmcp_test");
    expect(mode.nameMatches).toBe(true);
    expect(mode.base).toBe("coop");
    expect(mode.baseKind).toBe("builtin");
    expect(mode.maxPlayerCount).toBe(4);
    expect(mode.metadata.displayTitle).toBe("HSMCP Test Mutation");
    expect(mode.metadata.author).toBe("tests");
    expect(mode.convars).toEqual([{ name: "z_common_limit", value: "0" }]);
    expect(mode.script).not.toBeNull();
    expect(mode.script!.compiled).toBe(false);
    expect(mode.addonInfo.exists).toBe(true);

    const check = (await checkMutationTool.handler({ path: directory, limit: 200 }, ctx)) as unknown as {
      ok: boolean;
      errors: number;
      warnings: number;
      modeCount: number;
      findings: Array<{ rule: string }>;
    };
    expect(check.modeCount).toBe(1);
    expect(check.errors).toBe(0);
    expect(check.ok).toBe(true);
    expect(check.findings.map((finding) => finding.rule)).not.toContain("mode-no-script");

    const script = readVscriptTool.handler(
      { path: join(directory, "scripts", "vscripts", "hsmcp_test.nut") },
      ctx,
    ) as unknown as { mutationOptions: Record<string, string>; ok: boolean };
    expect(script.ok).toBe(true);
    expect(script.mutationOptions).toEqual({ CommonLimit: "0", TankLimit: "2" });
  }, 120_000);

  it("refuses to overwrite and takes a backup when asked", async () => {
    const directory = join(scratch, "overwrite");
    await writeAddon(directory);
    await expect(writeAddon(directory)).rejects.toThrow(/already exist/);
    const result = await writeAddon(directory, { overwrite: true, backup: true });
    expect(result.verified).toBe(true);
    expect(existsSync(join(directory, "modes", "hsmcp_test.txt.bak"))).toBe(true);
  }, 120_000);

  it("catches a mode that cannot load as written", async () => {
    const directory = join(scratch, "broken");
    await writeAddon(directory);
    const modePath = join(directory, "modes", "hsmcp_test.txt");
    writeFileSync(
      modePath,
      [
        '"wrong_name"',
        "{",
        '\t"base"\t\t"coop"',
        '\t"maxplayers"\t"9"',
        '\t"hasdifficulty"\t\t"yes"',
        '\t"DisplayTitle"\t"Broken"',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const check = (await checkMutationTool.handler({ path: directory, limit: 200 }, ctx)) as unknown as {
      ok: boolean;
      errors: number;
      findings: Array<{ rule: string; severity: string }>;
    };
    expect(check.ok).toBe(false);
    const rules = check.findings.map((finding) => finding.rule);
    expect(rules).toContain("mode-root-name");
    expect(rules).toContain("mode-flag-hasdifficulty");
    expect(rules).toContain("mode-maxplayers-base");
    expect(rules).toContain("mode-no-description");
  }, 120_000);

  it.skipIf(!has.gameContent)("checks Valve's own dash mode and compiled script", async () => {
    const vpk = join(ctx.config.gameDir!, "pak01_dir.vpk");
    if (!existsSync(vpk)) return;
    const addon = join(scratch, "stock");
    for (const filter of ["modes/dash.txt", "scripts/vscripts/dash.nuc"]) {
      const extracted = runVpkExtractTool.handler(
        { path: vpk, into: addon, filter, limit: 5, confirm: true } as never,
        ctx,
      ) as { written: Array<{ file: string }> };
      expect(extracted.written.length).toBe(1);
    }
    const mode = (await readGameModeTool.handler(
      { path: join(addon, "modes", "dash.txt") },
      ctx,
    )) as unknown as ModeReply;
    expect(mode.base).toBe("dash");
    expect(mode.baseKind).toBe("self");
    expect(mode.script).not.toBeNull();
    expect(mode.script!.compiled).toBe(true);

    const check = (await checkMutationTool.handler({ path: addon, limit: 200 }, ctx)) as unknown as {
      ok: boolean;
      errors: number;
      warnings: number;
      findings: Array<{ rule: string; severity: string }>;
    };
    expect(check.ok).toBe(true);
    expect(check.errors).toBe(0);
    expect(check.findings.map((finding) => finding.rule)).toContain("mode-base-self");
    expect(check.findings.map((finding) => finding.rule)).toContain("mode-script-compiled");
    // There is no addoninfo.txt in the extracted stock pair, and that is a warning, not an error.
    expect(check.findings.map((finding) => finding.rule)).toContain("mode-no-addoninfo");
  }, 120_000);
});
