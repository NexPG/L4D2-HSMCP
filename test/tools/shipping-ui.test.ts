import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { writeAddonInfoTool, aiCredit } from "../../src/packages/typescript/tools/addon.js";
import { writeCubemapGridTool } from "../../src/maps/typescript/tools/cubemapgrid.js";
import { writeLoadingScreenTool } from "../../src/textures/typescript/tools/loadingscreen.js";
import { checkVmtTool } from "../../src/textures/typescript/tools/vmtcheck.js";
import { checkSoundTool } from "../../src/audio/typescript/tools/soundcheck.js";
import { readEntities } from "../../src/maps/typescript/vmf/edit.js";
import { ctx as sharedCtx, has } from "../support/env.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-shipping-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n}\n';

function map(): string {
  const path = join(scratch, `map-${Math.round(performance.now() * 1000)}.vmf`);
  writeFileSync(path, SEED);
  return path;
}

function wav(bits: number, rate: number, channels: number, frames: number): Buffer {
  const blockAlign = (channels * bits) / 8;
  const data = Buffer.alloc(frames * blockAlign);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A valid 1x1 RGBA PNG; the native VTF writer decodes real pixels. */
function png(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanline = Buffer.from([0, 255, 0, 0, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanline)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("write_addoninfo", () => {
  it("writes a manifest with the AI credit and refuses an overwrite", async () => {
    const path = join(scratch, "addon", "addoninfo.txt");
    const result = (await writeAddonInfoTool.handler(
      { path, title: "Test Addon", author: "Tester", confirm: true } as never,
      ctx,
    )) as unknown as { written: boolean; aiCredit: string | null };
    expect(result.written).toBe(true);
    const body = readFileSync(path, "utf8");
    expect(body).toContain('"addontitle"\t"Test Addon"');
    expect(body).toContain("addonAICredit");
    expect(body).toContain(aiCredit());
    expect(() =>
      writeAddonInfoTool.handler(
        { path, title: "Again", confirm: true } as never,
        ctx,
      ),
    ).toThrow(/already exists/);
  });
});

describe("write_cubemap_grid", () => {
  it("places a 3x3 grid with the requested spacing", async () => {
    const path = map();
    const result = (await writeCubemapGridTool.handler(
      {
        path,
        bounds: { mins: [0, 0, 0], maxs: [1024, 1024, 256] },
        spacing: 512,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { ids: number[]; count: number };
    expect(result.count).toBe(9);
    const placed = readEntities(readFileSync(path, "utf8")).entities.filter((entity) =>
      result.ids.includes(entity.id!),
    );
    expect(placed).toHaveLength(9);
    expect(placed.every((entity) => entity.classname === "env_cubemap")).toBe(true);
    expect(placed.some((entity) => entity.keyvalues["origin"] === "1024 1024 64")).toBe(true);
  });
});

describe.skipIf(!has.sidecar)("write_loading_screen", () => {
  it("writes a VTF and an UnlitGeneric VMT from a PNG", async () => {
    const image = join(scratch, "poster.png");
    writeFileSync(image, png());
    const result = (await writeLoadingScreenTool.handler(
      {
        image,
        outDir: join(scratch, "addon", "materials", "vgui"),
        name: "LoadingScreen_Test",
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { vtf: string; vmt: string; materialPath: string };
    expect(result.materialPath).toBe("vgui/LoadingScreen_Test");
    expect(readFileSync(result.vmt, "utf8")).toContain("UnlitGeneric");
    expect(readFileSync(result.vmt, "utf8")).toContain('"$basetexture"\t"vgui/LoadingScreen_Test"');
    expect(readFileSync(result.vtf).subarray(0, 4).toString()).toBe("VTF\0");
  });
});

describe("check_vmt", () => {
  it("passes a valid material and fails one with no base texture", async () => {
    const materials = join(scratch, "materials");
    mkdirSync(join(materials, "vgui"), { recursive: true });
    writeFileSync(join(materials, "vgui", "ok.vtf"), "");
    const valid = join(materials, "vgui", "ok.vmt");
    writeFileSync(valid, '"UnlitGeneric"\n{\n\t"$basetexture"\t"vgui/ok"\n}\n');
    const pass = (await checkVmtTool.handler(
      { path: valid, materialsDirs: [materials] } as never,
      ctx,
    )) as unknown as { overall: string; counts: { error: number } };
    expect(pass.counts.error).toBe(0);
    expect(pass.overall).not.toBe("fail");

    const broken = join(scratch, "broken.vmt");
    writeFileSync(broken, '"LightmappedGeneric"\n{\n\t"$surfaceprop"\t"concrete"\n}\n');
    const fail = (await checkVmtTool.handler({ path: broken } as never, ctx)) as unknown as {
      overall: string;
    };
    expect(fail.overall).toBe("fail");
  });
});

describe.skipIf(!has.sidecar)("check_sound", () => {
  it("passes a 16-bit 44.1 kHz wave and warns on an 8-bit one", async () => {
    const good = join(scratch, "good.wav");
    writeFileSync(good, wav(16, 44100, 1, 100));
    const pass = (await checkSoundTool.handler({ path: good } as never, ctx)) as unknown as {
      overall: string;
      kind: string;
    };
    expect(pass.kind).toBe("wav");
    expect(pass.overall).not.toBe("fail");

    const bad = join(scratch, "bad.wav");
    writeFileSync(bad, wav(8, 11025, 1, 100));
    const warn = (await checkSoundTool.handler({ path: bad } as never, ctx)) as unknown as {
      overall: string;
      findings: Array<{ rule: string }>;
    };
    expect(warn.findings.some((finding) => finding.rule === "wav-not-game-ready")).toBe(true);
  });

  it("warns about a soundscript wave that does not exist", async () => {
    const script = join(scratch, "test_sounds.txt");
    writeFileSync(
      script,
      '"Test.Missing"\n{\n\t"channel"\t"CHAN_STATIC"\n\t"wave"\t"sound/missing.wav"\n}\n',
    );
    const result = (await checkSoundTool.handler({ path: script } as never, ctx)) as unknown as {
      missingWaves: string[];
      overall: string;
    };
    expect(result.missingWaves.length).toBeGreaterThan(0);
    expect(result.overall).toBe("warn");
  });
});
