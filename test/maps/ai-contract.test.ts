import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { checkAiContractTool } from "../../src/maps/typescript/tools/aicontract.js";
import { config, ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-ai-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function mapWithRescue(): string {
  const path = join(scratch, "rescue.vmf");
  writeFileSync(
    path,
    "versioninfo\n{\n\t\"editorversion\" \"400\"\n}\nworld\n{\n\t\"id\" \"1\"\n\t\"classname\" \"worldspawn\"\n}\n" +
      'entity\n{\n\t"id" "2"\n\t"classname" "info_survivor_rescue"\n\t"origin" "0 0 16"\n}\n',
  );
  return path;
}

describe.skipIf(!has.gameContent)("check_ai_contract", () => {
  it("reports c1m1's rescue points, closet areas and hiding spots", async () => {
    const maps = join(config.gameDir!, "maps");
    const r = (await checkAiContractTool.handler(
      { path: join(maps, "c1m1_hotel.bsp") } as never,
      ctx,
    )) as unknown as {
      navPath: string | null;
      entities: { rescuePoints: number };
      nav: { rescueClosetAreas: number; hidingSpots: number; inCover: number } | null;
      verdict: string;
    };
    expect(r.navPath).toMatch(/c1m1_hotel\.nav$/);
    expect(r.entities.rescuePoints).toBe(6);
    expect(r.nav!.rescueClosetAreas).toBe(4);
    expect(r.nav!.hidingSpots).toBe(760);
    expect(r.nav!.inCover).toBe(310);
    expect(r.verdict).toBe("pass");
  });

  it("passes a finale map with no rescue closet", async () => {
    const maps = join(config.gameDir!, "maps");
    const r = (await checkAiContractTool.handler(
      { path: join(maps, "c5m5_bridge.bsp") } as never,
      ctx,
    )) as unknown as {
      entities: { rescuePoints: number };
      nav: { rescueClosetAreas: number; hidingSpots: number } | null;
      verdict: string;
    };
    expect(r.entities.rescuePoints).toBe(0);
    expect(r.nav!.rescueClosetAreas).toBe(0);
    expect(r.nav!.hidingSpots).toBeGreaterThan(1000);
    expect(r.verdict).toBe("pass");
  });

  it("fails a rescue point against a nav with no RESCUE_CLOSET area", async () => {
    // c5m5_bridge's nav is a real record with zero rescue-closet areas.
    const nav = join(scratch, "no-closet.nav");
    copyFileSync(join(config.gameDir!, "maps", "c5m5_bridge.nav"), nav);
    const r = (await checkAiContractTool.handler(
      { path: mapWithRescue(), nav } as never,
      ctx,
    )) as unknown as {
      entities: { rescuePoints: number };
      nav: { rescueClosetAreas: number } | null;
      findings: Array<{ rule: string }>;
      verdict: string;
    };
    expect(r.entities.rescuePoints).toBe(1);
    expect(r.nav!.rescueClosetAreas).toBe(0);
    expect(r.findings.map((f) => f.rule)).toContain("rescue-without-closet");
    expect(r.verdict).toBe("fail");
  });
});
