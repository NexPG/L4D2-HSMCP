import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/registry.js";
import { runHlmvTool } from "../../src/tools/hlmv.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

describe.skipIf(!has.gameContent)("run_hlmv", () => {
  it("accepts a stock model that lives in a VPK, not only a loose file", async () => {
    const bin = ctx.config.binDir;
    if (!bin || !existsSync(join(bin, "hlmv.exe"))) return;
    const r = (await runHlmvTool.handler(
      { model: "models/props_unique/escalator01_left.mdl", close: true, confirm: true } as never,
      ctx,
    )) as { loose: boolean; model: string; launched: boolean };
    expect(r.loose).toBe(false);
    expect(r.model).toContain("models/props_unique/escalator01_left.mdl");
    expect(r.launched).toBe(true);
  });
});
