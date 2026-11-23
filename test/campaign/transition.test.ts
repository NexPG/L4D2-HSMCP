import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkCampaignWiringTool,
  checkTransitionTool,
  writeChangelevelTool,
} from "../../src/campaigns/typescript/tools/campaignbuild.js";
import { editVmf } from "../../src/maps/typescript/tools/vmfedit.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { config, ctx as sharedCtx, FIXTURES, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-transition-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function map(name: string): Promise<string> {
  const path = join(scratch, `${name}.vmf`);
  copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), path);
  return path;
}

async function door(path: string, origin: [number, number, number]): Promise<void> {
  await editVmf.handler(
    {
      path,
      ops: [
        {
          op: "add",
          keyvalues: {
            classname: "prop_door_rotating_checkpoint",
            model: "models/props_doors/checkpoint_door_-02.mdl",
            origin: origin.join(" "),
          },
        },
      ],
      backup: false,
      dryRun: false,
      confirm: true,
    } as never,
    ctx as never,
  );
}

async function chain(
  firstName: string,
  secondName: string,
  doors: { first: boolean; second: boolean },
): Promise<{ first: string; second: string }> {
  const first = await map(firstName);
  const second = await map(secondName);
  for (const [path, role, mapName] of [
    [first, "departure", secondName],
    [second, "arrival", secondName],
  ] as const) {
    await writeChangelevelTool.handler(
      {
        path,
        role,
        map: mapName,
        landmark: "pair_landmark",
        bounds: { mins: [-64, -64, 0], maxs: [64, 64, 64] },
        confirm: true,
      } as never,
      ctx,
    );
  }
  if (doors.first) await door(first, [0, 0, 16]);
  if (doors.second) await door(second, [0, 0, 16]);
  return { first, second };
}

describe("check_transition", () => {
  it("passes a pair whose checkpoint doors are unnamed", async () => {
    const { first, second } = await chain("pair_a", "pair_b", { first: true, second: true });
    const r = (await checkTransitionTool.handler(
      { first, next: second } as never,
      ctx,
    )) as unknown as {
      ok: boolean;
      findings: Array<{ severity: string; rule: string }>;
    };
    expect(r.ok, JSON.stringify(r.findings, null, 2)).toBe(true);
    // Class is the key; the empty name is advice, never an error.
    expect(r.findings.some((f) => f.rule === "checkpoint-door-name")).toBe(true);
    expect(r.findings.some((f) => f.rule === "checkpoint-door-missing")).toBe(false);
  });

  it("fails a safe room whose checkpoint door is missing", async () => {
    const { first, second } = await chain("no_door_a", "no_door_b", {
      first: true,
      second: false,
    });
    const r = (await checkTransitionTool.handler(
      { first, next: second } as never,
      ctx,
    )) as unknown as {
      ok: boolean;
      findings: Array<{ rule: string; message: string }>;
    };
    expect(r.ok).toBe(false);
    const missing = r.findings.filter((f) => f.rule === "checkpoint-door-missing");
    expect(missing.length).toBe(1);
    expect(missing[0]!.message).toMatch(/pair_landmark/);
  });

  it.skipIf(!has.gameContent)(
    "passes a stock pair with an unnamed door and a chapter with no player start",
    async () => {
      const maps = join(config.gameDir!, "maps");
      const first = join(maps, "c1m1_hotel.bsp");
      const second = join(maps, "c1m2_streets.bsp");
      if (!existsSync(first) || !existsSync(second)) return;
      const single = (await checkTransitionTool.handler(
        { first, next: second } as never,
        ctx,
      )) as unknown as {
        ok: boolean;
        findings: Array<{ severity: string; rule: string; message: string }>;
      };
      expect(single.ok, JSON.stringify(single.findings, null, 2)).toBe(true);
      expect(single.findings.some((f) => f.rule === "checkpoint-door-missing")).toBe(false);

      // The old name-based wiring check failed this pair: c1m1's only door is named
      // `checkpoint_entrance`, and c1m2 has no info_player_start.
      const wiring = (await checkCampaignWiringTool.handler(
        { maps: [first, second], requireFinale: false } as never,
        ctx,
      )) as unknown as {
        counts: { error: number };
        findings: Array<{ severity: string; rule: string }>;
      };
      expect(wiring.counts.error, JSON.stringify(wiring.findings, null, 2)).toBe(0);
      expect(
        wiring.findings.some(
          (f) => f.rule.startsWith("checkpoint-") && f.severity !== "info",
        ),
      ).toBe(false);
    },
  );
});
