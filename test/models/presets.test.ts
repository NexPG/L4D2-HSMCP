/**
 * Bodygroup presets are a mixed-radix table in the v49 MDL header. No stock L4D2 model has
 * one, so the records are injected into a real MDL at the documented offsets and read back
 * through the normal geometry parser. The decoder is the algorithm Crowbar's
 * `WriteBodyGroupPresetCommand` describes: walk the parts backwards, subtract `base` from the
 * mask, and divide the value by `base` to get the selected model.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readModelBodygroupsTool } from "../../src/models/typescript/tools/bodygroups.js";
import { decompileModelTool } from "../../src/models/typescript/tools/decompile.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { modelSiblings } from "../../src/assets/typescript/game/models.js";
import { openGameVpk } from "../../src/assets/typescript/game/vpkcontent.js";
import { parseModelGeometry } from "../../src/models/typescript/formats/mdlmesh.js";
import { ctx, has } from "../support/env.js";

const toolCtx = ctx as unknown as ToolContext;

const gameDir = ctx.config.gameDir;

/** Appends preset records to a real MDL and points the header at them. */
function withPresets(
  mdl: Buffer,
  presets: Array<{ name: string; value: number; mask: number }>,
): Buffer {
  const start = mdl.length;
  const records = Buffer.alloc(presets.length * 12);
  const names: Buffer[] = [];
  let nameAt = start + records.length;
  presets.forEach((preset, index) => {
    const name = Buffer.from(`${preset.name}\0`, "latin1");
    records.writeInt32LE(nameAt - (start + index * 12), index * 12);
    records.writeInt32LE(preset.value, index * 12 + 4);
    records.writeInt32LE(preset.mask, index * 12 + 8);
    names.push(name);
    nameAt += name.length;
  });
  const result = Buffer.concat([mdl, records, ...names]);
  result.writeInt32LE(presets.length, 444);
  result.writeInt32LE(start, 448);
  result.writeInt32LE(result.length, 76);
  return result;
}

function geometry(name: string, mdl: Buffer) {
  const archive = openGameVpk(gameDir!)!;
  const siblings = modelSiblings(name);
  const vvd = archive.read(siblings.vvd);
  if (!vvd) return null;
  for (const candidate of siblings.vtx) {
    const vtx = archive.read(candidate);
    if (!vtx) continue;
    const parsed = parseModelGeometry(mdl, vvd, vtx);
    if (parsed) return parsed;
  }
  return null;
}

describe.skipIf(!has.gameContent)("bodygroup presets", () => {
  it("decodes a preset over a three-model body part", () => {
    const name = "models/brokenglass_piece.mdl";
    const original = openGameVpk(gameDir!)!.read(name);
    expect(original).not.toBeNull();
    const parsed = geometry(name, withPresets(original!, [{ name: "damaged", value: 1, mask: 1 }]));
    expect(parsed).not.toBeNull();
    expect(parsed!.bodyParts).toHaveLength(1);
    const part = parsed!.bodyParts[0]!;
    expect(part.models).toHaveLength(3);
    expect(parsed!.presets).toEqual([
      {
        name: "damaged",
        value: 1,
        mask: 1,
        parts: [{ part: part.name, index: 1 }],
      },
    ]);
  });

  it("uses a part's base as the radix on a multi-part model", () => {
    const name = "models/infected/common_morph_test.mdl";
    const original = openGameVpk(gameDir!)!.read(name);
    expect(original).not.toBeNull();
    const base = geometry(name, original!);
    expect(base).not.toBeNull();
    const multi = base!.bodyParts.findIndex((part) => part.models.length > 1);
    expect(multi).toBeGreaterThanOrEqual(0);
    const part = base!.bodyParts[multi]!;
    // A mask that selects exactly this part, value 3 inside its radix. The decoder walks
    // parts backwards, so the expected list is still in natural body-part order.
    const parsed = geometry(name, withPresets(original!, [{ name: "chosen", value: 3, mask: 1 }]));
    expect(parsed).not.toBeNull();
    expect(parsed!.presets).toEqual([
      {
        name: "chosen",
        value: 3,
        mask: 1,
        parts: [{ part: part.name, index: 3 }],
      },
    ]);
  });

  it("has no presets in the unmodified stock model", () => {
    const name = "models/infected/common_morph_test.mdl";
    const original = openGameVpk(gameDir!)!.read(name)!;
    const parsed = geometry(name, original);
    expect(parsed).not.toBeNull();
    expect(parsed!.presets).toEqual([]);
  });

  it("reports body parts and their bases", async () => {
    const reply = (await readModelBodygroupsTool.handler(
      { model: "infected/common_morph_test.mdl" },
      toolCtx,
    )) as unknown as {
      bodyPartCount: number;
      bodyParts: Array<{ name: string; base: number; modelCount: number }>;
      presetCount: number;
      note: string;
    };
    expect(reply.bodyPartCount).toBe(4);
    expect(reply.bodyParts.map((part) => part.base)).toEqual([1, 1, 5, 5]);
    expect(reply.bodyParts[1]!.modelCount).toBe(5);
    expect(reply.presetCount).toBe(0);
    expect(reply.note).toMatch(/no `\$bodygrouppreset`/);
  });

  it.skipIf(!has.toolchain)(
    "records that L4D2's compiler rejects $bodygrouppreset",
    { timeout: 60_000 },
    async () => {
      const name = "models/infected/common_morph_test.mdl";
      const original = openGameVpk(gameDir!)!.read(name)!;
      const source = geometry(name, original)!;
      const part = source.bodyParts.find((candidate) => candidate.models.length > 1);
      expect(part).toBeDefined();

      const outDir = mkdtempSync(join(tmpdir(), "hammer-preset-"));
      const decompiled = (await decompileModelTool.handler(
        {
          model: "infected/common_morph_test.mdl",
          outDir,
          overwrite: true,
          confirm: true,
          modelname: "hsmcp_preset_test/common_morph_test.mdl",
        } as never,
        toolCtx,
      )) as { qc: string };
      let qc = readFileSync(decompiled.qc, "utf8");
      const block = `$bodygrouppreset "hsmcp_test"\n{\n\t"${part!.name}" 3\n}\n`;
      const at = qc.indexOf("$cdmaterials");
      expect(at).toBeGreaterThan(0);
      qc = qc.slice(0, at) + block + qc.slice(at);
      writeFileSync(decompiled.qc, qc);

      const compiled = (await runStudiomdlTool.handler(
        { qc: decompiled.qc, timeoutMinutes: 10 } as never,
        toolCtx,
      )) as { ok: boolean; modelExists: boolean; logTail: string[] };
      expect(compiled.ok).toBe(false);
      expect(compiled.modelExists).toBe(false);
      expect(compiled.logTail.join("\n")).toContain("bad command $bodygrouppreset");
      rmSync(outDir, { recursive: true, force: true });
    },
  );
});
