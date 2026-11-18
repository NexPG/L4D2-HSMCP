import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runBuildCubemapsTool } from "../../src/textures/typescript/tools/buildcubemaps.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

describe.skipIf(!has.gameContent)("run_build_cubemaps", () => {
  it("refuses a map that is neither installed nor supplied", async () => {
    await expect(
      runBuildCubemapsTool.handler(
        {
          map: "hsmcp_map_that_does_not_exist",
          mode: "hdr",
          addonsToHide: [],
          timeoutSeconds: 30,
          confirm: true,
        },
        ctx,
      ),
    ).rejects.toThrow(/does not exist and no bsp was given/);
  });

  it("refuses a bsp path that does not exist before launching", async () => {
    await expect(
      runBuildCubemapsTool.handler(
        {
          map: "hsmcp_map_that_does_not_exist",
          bsp: "test/fixtures/no_such_map.bsp",
          mode: "hdr",
          addonsToHide: [],
          timeoutSeconds: 30,
          confirm: true,
        },
        ctx,
      ),
    ).rejects.toThrow(/ENOENT|no such file/i);
  });

  it("refuses pack without an output map", async () => {
    await expect(
      runBuildCubemapsTool.handler(
        {
          map: "hsmcp_map_that_does_not_exist",
          bsp: "test/fixtures/hmcp_probe.bsp",
          pack: true,
          mode: "hdr",
          addonsToHide: [],
          timeoutSeconds: 30,
          confirm: true,
        },
        ctx,
      ),
    ).rejects.toThrow(/pack: true needs outBsp/);
  });
});
