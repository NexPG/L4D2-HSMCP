import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/registry.js";
import { writeVscript } from "../../src/tools/vscript.js";
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
    ).rejects.toThrow(/unbalanced braces/);
  });

  it("warns about Lua habits instead of silently writing them", async () => {
    const out = (await writeVscript.handler(
      {
        path: join(scratch, "lua.nut"),
        content: "local x = 1\nif x then\nend\n",
        confirm: true,
      },
      ctx,
    )) as { warnings: string[] };
    expect(out.warnings.some((w) => w.includes("Lua"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("end"))).toBe(true);
  });

  it("refuses a file that is not .nut", async () => {
    await expect(
      writeVscript.handler({ path: join(scratch, "x.lua"), content: GOOD, confirm: true }, ctx),
    ).rejects.toThrow(/\.nut/);
  });
});
