import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { parseVrd } from "../../src/models/typescript/formats/mdlprocedural.js";
import { readVrdTool } from "../../src/models/typescript/tools/procedural.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-vrd-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const GOOD = `<helper> Bip01_L_Elbow  Bip01_L_UpperArm Bip01_L_Shoulder Bip01_L_Hand
<display> 1 1 1 0
<basepos> 0 0 0
<trigger> 30 0 0 0 0 0 0 12.5 3 0

<aimconstraint> Bip01_Head Bip01_Neck Bip01_Eyes
<aimvector> 0 1 0
<upvector> 0 0 1
<basepos> 1 2 3
`;

describe("read_vrd", () => {
  it("reads helpers, triggers and aim constraints", async () => {
    const path = join(scratch, "good.vrd");
    writeFileSync(path, GOOD, "utf8");
    const result = (await readVrdTool.handler({ path } as never, ctx)) as {
      count: number;
      warnings: string[];
      entries: Array<{
        kind: string;
        bone: string;
        triggers?: Array<{ tolerance: number; position: number[] }>;
        aimVector?: number[];
      }>;
    };
    expect(result.count).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.entries[0]?.kind).toBe("quatinterp");
    expect(result.entries[0]?.triggers?.[0]?.tolerance).toBe(30);
    expect(result.entries[0]?.triggers?.[0]?.position).toEqual([12.5, 3, 0]);
    expect(result.entries[1]?.kind).toBe("aim");
    expect(result.entries[1]?.aimVector).toEqual([0, 1, 0]);
  });

  it("names the errors a compile would swallow", () => {
    const bad = `<helper> Bone Parent ControlParent Control
<display> 1 1 1 0
<trigger> 30 0 0 0 0 0 0 12.5 3
<widget> 1

<aimconstraint> Head Neck Eyes
<aimvector> 0 1 0
`;
    const parsed = parseVrd(bad);
    expect(parsed.entries).toHaveLength(2);
    const text = parsed.warnings.join("\n");
    expect(text).toContain("<trigger> needs 10 number(s)");
    expect(text).toContain("unknown tag <widget>");
    expect(text).toContain("no <basepos>");
    expect(text).toContain("needs <aimvector> and <upvector>");
  });
});
