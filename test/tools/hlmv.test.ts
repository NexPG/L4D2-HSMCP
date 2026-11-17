import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/registry.js";
import { runHlmvTool } from "../../src/tools/hlmv.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

describe.skipIf(!has.gameContent)("run_hlmv", () => {
  it("refuses a model that does not exist", () => {
    expect(() =>
      runHlmvTool.handler(
        { model: "hsmcp_test/definitely_missing.mdl", confirm: true },
        ctx,
      ),
    ).toThrow(/does not exist/);
  });
});
