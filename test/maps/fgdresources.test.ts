import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readFgdResourcesTool } from "../../src/maps/typescript/tools/fgdresources.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const ready = has.sidecar && has.fgd;

describe("read_fgd_resources", () => {
  it.skipIf(!ready)("lists the asset keys of a door and its L4D2 traps", async () => {
    const result = (await readFgdResourcesTool.handler(
      { classname: "prop_door_rotating" } as never,
      ctx,
    )) as {
      resources: Array<{ key: string; type: string; default: string | null }>;
      notes: string[];
      byType: Record<string, number>;
    };
    expect(result.resources.some((r) => r.key === "model" && r.type === "STR_MODEL")).toBe(true);
    // The FGD declares five sound-override keys, and L4D2 ignores all of them.
    expect(result.resources.filter((r) => r.type === "STR_SOUND")).toHaveLength(5);
    expect(result.notes.join(" ")).toContain("door_options");
    expect(result.notes.join(" ")).toContain("checkpoint_exit");
  });

  it.skipIf(!ready)("says when a class carries no asset key at all", async () => {
    const result = (await readFgdResourcesTool.handler(
      { classname: "logic_relay" } as never,
      ctx,
    )) as { resources: unknown[]; note?: string };
    expect(result.resources).toEqual([]);
    expect(result.note).toContain("no asset keyvalue");
  });
});
