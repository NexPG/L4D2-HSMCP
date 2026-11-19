import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readVscriptTool, writeVscript } from "../../src/scripts/typescript/tools/vscript.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-vscript-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const GOOD = `// test script
printl( "[TEST] loaded" );

function OnGameplayStart()
{
	printl( "[TEST] start" );
}
`;

describe("write_vscript", () => {
  it("writes a .nut and reads its size back", async () => {
    const path = join(scratch, "good.nut");
    const out = (await writeVscript.handler(
      { path, content: GOOD, confirm: true },
      ctx,
    )) as { bytes: number; attached: boolean; warnings: string[] };
    expect(readFileSync(path, "utf8")).toContain("OnGameplayStart");
    expect(out.bytes).toBeGreaterThan(0);
    expect(out.attached).toBe(false);
    expect(out.warnings).toEqual([]);
  });

  it("refuses unbalanced braces", async () => {
    await expect(
      writeVscript.handler(
        { path: join(scratch, "broken.nut"), content: "function X() {\n", confirm: true },
        ctx,
      ),
    ).rejects.toThrow(/would not compile|never closed/);
  });

  it("refuses Lua syntax instead of silently writing it", async () => {
    const path = join(scratch, "lua.nut");
    await expect(
      writeVscript.handler(
        { path, content: "printl(\"x\")\nif x then\nend\n", confirm: true },
        ctx,
      ),
    ).rejects.toThrow(/then|end/);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a file that is not .nut", async () => {
    await expect(
      writeVscript.handler({ path: join(scratch, "x.lua"), content: GOOD, confirm: true }, ctx),
    ).rejects.toThrow(/\.nut/);
  });
});

describe("read_vscript", () => {
  it("returns the DirectorOptions stage list and the diagnostics", async () => {
    const path = join(scratch, "finale.nut");
    writeFileSync(
      path,
      [
        'printl( "[TEST] loaded" );',
        "PANIC <- 0",
        "DELAY <- 2",
        "DirectorOptions <-",
        "{",
        "  A_CustomFinale_StageCount = 2",
        "  A_CustomFinale1 = PANIC",
        "  A_CustomFinaleValue1 = 1",
        "  A_CustomFinale2 = DELAY",
        "  A_CustomFinaleValue2 = 5",
        "}",
        "function OnBeginCustomFinaleStage( num, type )",
        "{",
        '  printl( "[TEST] stage " + num );',
        "}",
      ].join("\n"),
    );
    const out = (await readVscriptTool.handler({ path }, ctx)) as {
      ok: boolean;
      stageCount: number;
      stages: Array<{ type: string }>;
      functions: string[];
      diagnostics: Array<{ severity: string }>;
    };
    expect(out.ok).toBe(true);
    expect(out.stageCount).toBe(2);
    expect(out.stages.map((stage) => stage.type)).toEqual(["PANIC", "DELAY"]);
    expect(out.functions).toContain("OnBeginCustomFinaleStage");
    expect(out.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  });
});