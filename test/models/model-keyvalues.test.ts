import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readModelKeyValuesTool } from "../../src/models/typescript/tools/keyvalues.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

describe("read_model_keyvalues", () => {
  it.skipIf(!has.gameContent)("reads door_options from a checkpoint door", async () => {
    const result = (await readModelKeyValuesTool.handler(
      { model: "models/props_doors/checkpoint_door_02.mdl" } as never,
      ctx,
    )) as {
      found: boolean;
      blocks: string[];
      doorOptions: Record<string, string> | null;
    };
    expect(result.found).toBe(true);
    expect(result.blocks).toContain("door_options");
    expect(result.doorOptions).not.toBeNull();
    // L4D2 takes a door's sounds from the model, so these are the values a recompile must keep.
    expect(result.doorOptions?.open).toMatch(/^Doors\./);
    expect(result.doorOptions?.move).toMatch(/^Doors\./);
  }, 30_000);

  it.skipIf(!has.gameContent)("says a model without the block has no door sounds", async () => {
    const result = (await readModelKeyValuesTool.handler(
      { model: "models/props_junk/gascan001a.mdl" } as never,
      ctx,
    )) as { found: boolean; blocks: string[]; doorOptions: Record<string, string> | null };
    expect(result.found).toBe(true);
    expect(result.blocks).not.toContain("door_options");
    expect(result.doorOptions).toBeNull();
  }, 30_000);
});
