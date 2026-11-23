import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { setWorldspawnTool } from "../../src/maps/typescript/tools/worldspawn.js";
import { readVmfLint } from "../../src/maps/typescript/tools/vmf.js";
import { ctx as sharedCtx, FIXTURES, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-worldspawn-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const ready = has.sidecar && has.fgd;

describe("worldspawn choices", () => {
  it.skipIf(!ready)("reports timeofday 1 and values L4D2 does not ship", async () => {
    const vmf = join(scratch, "world.vmf");
    copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), vmf);
    await setWorldspawnTool.handler(
      {
        path: vmf,
        set: {
          timeofday: "1",
          skyname: "sky_not_a_real_sky",
          musicpostfix: "NotASet",
          detailmaterial: "detail/notreal",
        },
        confirm: true,
      } as never,
      ctx,
    );

    const lint = (await readVmfLint.handler({ path: vmf, limit: 200 } as never, ctx)) as {
      byRule: Record<string, number>;
      findings: Array<{ rule: string; key?: string; message: string }>;
    };

    expect(lint.byRule["l4d2-timeofday-unused"]).toBe(1);
    expect(lint.byRule["l4d2-worldspawn-choice"]).toBe(3);
    const timeOfDay = lint.findings.find((f) => f.rule === "l4d2-timeofday-unused");
    // The message is the part an agent reads: it must name the three real values.
    expect(timeOfDay?.message).toContain("0 (Sitting Witch");
    expect(timeOfDay?.message).toContain("3 (Walking Witch");
    expect(timeOfDay?.message).toContain("2 (Sitting Witch (Morning))");
  }, 60_000);
});
