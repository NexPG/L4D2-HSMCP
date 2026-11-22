/**
 * `check_assets` is the source-side half of `map_dependencies`: it resolves a .vmf's own
 * references against the game's mount chain before compiling. The tests need the real game
 * content because the question is "can this install supply it"; on a bare runner they skip.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { checkAssetsTool } from "../../src/maps/typescript/tools/assets.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { emptyVmf } from "../../src/maps/typescript/vmf/skeleton.js";
import { ctx as sharedCtx, FIXTURES, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-assets-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Missing {
  path: string;
  kind: string;
  referencedBy: string;
}

interface Reply {
  gameMounted: boolean;
  gameError: string | null;
  materialCount: number;
  modelCount: number;
  soundCount: number;
  skyCount: number;
  checked: number;
  resolved: number;
  bySource: Record<string, number>;
  missing: Missing[];
  missingCount: number;
  warnings: string[];
  game: { gameDir: string | null };
}

function box(material: string): string {
  return insertSolids(emptyVmf(), [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }], {
    material,
  }).text;
}

function entity(id: number, classname: string, key: string, value: string): string {
  return (
    ["entity", "{", `\t"id" "${id}"`, `\t"classname" "${classname}"`, `\t"${key}" "${value}"`, "}", ""].join(
      "\n",
    )
  );
}

async function check(text: string): Promise<Reply> {
  const path = join(scratch, `assets-${Math.round(performance.now() * 1000)}.vmf`);
  writeFileSync(path, text);
  return (await checkAssetsTool.handler({ path }, ctx)) as unknown as Reply;
}

const canCheck = has.sidecar && has.gameContent;

describe.skipIf(!canCheck)("check_assets", () => {
  it("finds nothing missing in the probe, including its HDR-only sky", async () => {
    const path = join(FIXTURES, "hmcp_probe.vmf");
    const reply = (await checkAssetsTool.handler(
      { path },
      ctx,
    )) as unknown as Reply;

    expect(reply.gameMounted).toBe(true);
    expect(reply.materialCount).toBeGreaterThan(0);
    expect(reply.skyCount).toBe(6);
    expect(reply.missing).toEqual([]);
    expect(reply.missingCount).toBe(0);
    expect(reply.bySource["game-vpk"] ?? 0).toBeGreaterThan(0);
    expect(reply.game.gameDir).toContain("left4dead2");
  });

  it("names a misspelled material as a missing material", async () => {
    const reply = await check(box("BRICK/NOT_A_REAL_MATERIAL_HMCP"));
    expect(reply.missing.map((m) => m.kind)).toContain("material");
    expect(reply.missing.map((m) => m.path)).toContain(
      "materials/brick/not_a_real_material_hmcp.vmt",
    );
  });

  it("resolves a stock prop and checks the model's own materials", async () => {
    const reply = await check(
      box("DEV/DEV_MEASUREGENERIC01") +
        entity(900, "prop_static", "model", "models/props_junk/gascan001a.mdl"),
    );
    expect(reply.modelCount).toBe(1);
    expect(reply.missing).toEqual([]);
    // The model's own material, its texture and the three required siblings.
    expect(reply.resolved).toBeGreaterThan(4);
  });

  it("names the .mdl, .vvd and .dx90.vtx of a model that does not exist", async () => {
    const reply = await check(
      box("DEV/DEV_MEASUREGENERIC01") +
        entity(900, "prop_static", "model", "models/does_not_exist/hmcp.mdl"),
    );
    const paths = reply.missing.filter((m) => m.kind === "model").map((m) => m.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "models/does_not_exist/hmcp.mdl",
        "models/does_not_exist/hmcp.vvd",
        "models/does_not_exist/hmcp.dx90.vtx",
      ]),
    );
  });

  it("checks a .wav sound but not a soundscript name", async () => {
    const reply = await check(
      box("DEV/DEV_MEASUREGENERIC01") +
        entity(900, "ambient_generic", "message", "ambient/missing_hmcp.wav") +
        entity(901, "ambient_generic", "message", "Weapon_Shotgun.Single"),
    );
    expect(reply.soundCount).toBe(1);
    expect(reply.missing.map((m) => m.path)).toContain("sound/ambient/missing_hmcp.wav");
    expect(reply.missing.map((m) => m.path)).not.toContain(
      "sound/weapon_shotgun.single",
    );
  });

  it("checks particle effects and VScripts", async () => {
    const reply = await check(
      box("DEV/DEV_MEASUREGENERIC01") +
        entity(900, "info_particle_system", "effect_name", "missing_hmcp") +
        entity(901, "logic_script", "Group00", "missing_hmcp.nut"),
    );
    const paths = reply.missing.map((m) => m.path);
    expect(paths).toContain("particles/missing_hmcp.pcf");
    expect(paths).toContain("scripts/vscripts/missing_hmcp.nut");
  });
});
