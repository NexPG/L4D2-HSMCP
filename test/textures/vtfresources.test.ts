/**
 * VTF resources that are data: hotspots and particle sheets.
 *
 * The writer is checked by `srctools.vtf`, which is also `read_vtf`'s reader: a payload that
 * this test agrees with itself about would prove nothing. The stronger assertion is the one
 * about the image: the high-res block is read before and after, and must be byte-identical,
 * because a resource edit that re-encoded the mips would change a DXT texture.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runVpkExtractTool } from "../../src/packages/typescript/tools/vpk.js";
import { readVtfHeader } from "../../src/textures/typescript/bsp/vtf.js";
import {
  VTF_RESOURCE_HIGH_RES,
  VTF_RESOURCE_HOTSPOT,
  VTF_RESOURCE_PARTICLE_SHEET,
  readVtfResourcePayload,
  readVtfResourceTable,
} from "../../src/textures/typescript/formats/vtfresources.js";
import {
  readVtfTool,
  writeVtfHotspotTool,
  writeVtfParticleSheetTool,
} from "../../src/textures/typescript/tools/vtf.js";
import { config, ctx, has } from "../support/env.js";

const toolCtx = ctx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-vtf-res-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A 1x1 RGBA PNG: the smallest source `write_vtf` accepts, so the fixture is not an asset. */
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function makeVtf(name: string): Promise<string> {
  const image = join(scratch, `${name}.png`);
  writeFileSync(image, Buffer.from(ONE_PIXEL_PNG, "base64"));
  const path = join(scratch, `${name}.vtf`);
  await callSidecar("vtf_write", { path, image, resize: "none" }, config);
  return path;
}

interface Resources {
  resources: Array<{ id: string | null; rawId: string; flags: number; size: number | null }>;
  sheetInfo: Array<{
    sequence: number;
    clamp: boolean;
    duration: number;
    frameCount: number;
    frames?: Array<{ duration: number; coords: number[][] }>;
  }>;
  hotspotInfo: Array<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    randomRotation: boolean;
    randomReflection: boolean;
    alternate: boolean;
  }> | null;
  hotspotFlags: number;
}

const readResources = (path: string): Promise<Resources> =>
  callSidecar<Resources>("vtf_resources", { path, frames: true }, config);

describe.skipIf(!has.sidecar)("VTF resource writes", () => {
  it("adds hotspots without touching the image", async () => {
    const path = await makeVtf("hotspot");
    const header = readVtfHeader(readFileSync(path))!;
    expect(header.width).toBe(1);
    const beforeBytes = readFileSync(path);
    const beforeTable = readVtfResourceTable(beforeBytes);
    const imageStart = beforeTable.entries.find(
      (entry) => entry.id === VTF_RESOURCE_HIGH_RES,
    )!.dataOffset!;
    const imageBefore = beforeBytes.subarray(imageStart);
    const bytesBefore = beforeBytes.length;

    const rects = [
      {
        minX: 0,
        minY: 0,
        maxX: 1,
        maxY: 1,
        randomRotation: true,
        randomReflection: false,
        alternate: false,
      },
      {
        minX: 0,
        minY: 0,
        maxX: 1,
        maxY: 1,
        randomRotation: false,
        randomReflection: true,
        alternate: true,
      },
    ];
    const result = (await writeVtfHotspotTool.handler(
      { path, rects, flags: 7, backup: true, confirm: true } as never,
      toolCtx,
    )) as { verified: boolean; rects: number; flags: number; backup: string | null; bytes: number };

    expect(result.verified).toBe(true);
    expect(result.rects).toBe(2);
    expect(result.flags).toBe(7);
    expect(result.backup).not.toBeNull();
    expect(existsSync(result.backup!)).toBe(true);
    expect(result.bytes).toBeGreaterThan(bytesBefore);

    const afterBytes = readFileSync(path);
    const afterTable = readVtfResourceTable(afterBytes);
    const imageAfterStart = afterTable.entries.find(
      (entry) => entry.id === VTF_RESOURCE_HIGH_RES,
    )!.dataOffset!;
    expect(
      afterBytes
        .subarray(imageAfterStart, imageAfterStart + imageBefore.length)
        .equals(imageBefore),
    ).toBe(true);
    expect(afterTable.entries.some((entry) => entry.id === VTF_RESOURCE_HOTSPOT)).toBe(true);
    expect(readVtfResourcePayload(afterBytes, VTF_RESOURCE_HOTSPOT)).not.toBeNull();

    const decoded = await readResources(path);
    expect(decoded.hotspotFlags).toBe(7);
    expect(decoded.hotspotInfo).toEqual(rects);

    // srctools removes the hotspot resource from the generic table and decodes it, so the
    // proof is the decoded rectangles, and the raw entry was checked above.
    const details = (await readVtfTool.handler({ path, details: true }, toolCtx)) as {
      hotspotInfo: unknown;
    };
    expect(details.hotspotInfo).toEqual(rects);

    // Replacing the same resource must not add a second table entry.
    const countBefore = afterTable.count;
    const replaced = (await writeVtfHotspotTool.handler(
      {
        path,
        rects: [rects[0]],
        backup: false,
        confirm: true,
      } as never,
      toolCtx,
    )) as { verified: boolean; backup: string | null };
    expect(replaced.verified).toBe(true);
    expect(replaced.backup).toBeNull();
    const finalTable = readVtfResourceTable(readFileSync(path));
    expect(finalTable.count).toBe(countBefore);
    expect((await readResources(path)).hotspotInfo).toEqual([rects[0]]);
  }, 120_000);

  it("writes particle-sheet sequences the sidecar decodes back", async () => {
    const path = await makeVtf("sheet");
    const beforeBytes = readFileSync(path);
    const beforeTable = readVtfResourceTable(beforeBytes);
    const imageStart = beforeTable.entries.find(
      (entry) => entry.id === VTF_RESOURCE_HIGH_RES,
    )!.dataOffset!;
    const imageBefore = beforeBytes.subarray(imageStart);

    const result = (await writeVtfParticleSheetTool.handler(
      {
        path,
        sequences: [
          {
            sequence: 3,
            clamp: true,
            duration: 0.5,
            frames: [
              { duration: 0.2, left: 0, top: 0, right: 0.5, bottom: 1 },
              { duration: 0.3, left: 0.5, top: 0, right: 1, bottom: 1 },
            ],
          },
        ],
        backup: true,
        confirm: true,
      } as never,
      toolCtx,
    )) as {
      verified: boolean;
      sequences: number;
      frames: number;
      version: number;
      backup: string | null;
    };
    expect(result.verified).toBe(true);
    expect(result.sequences).toBe(1);
    expect(result.frames).toBe(2);
    expect(result.version).toBe(1);
    expect(result.backup).not.toBeNull();

    const afterBytes = readFileSync(path);
    const afterTable = readVtfResourceTable(afterBytes);
    const imageAfterStart = afterTable.entries.find(
      (entry) => entry.id === VTF_RESOURCE_HIGH_RES,
    )!.dataOffset!;
    expect(
      afterBytes
        .subarray(imageAfterStart, imageAfterStart + imageBefore.length)
        .equals(imageBefore),
    ).toBe(true);
    expect(afterTable.entries.some((entry) => entry.id === VTF_RESOURCE_PARTICLE_SHEET)).toBe(true);

    const decoded = await readResources(path);
    expect(decoded.sheetInfo).toHaveLength(1);
    const sheet = decoded.sheetInfo[0]!;
    expect(sheet.sequence).toBe(3);
    expect(sheet.clamp).toBe(true);
    expect(sheet.duration).toBeCloseTo(0.5, 6);
    expect(sheet.frames).toHaveLength(2);
    expect(sheet.frames![0]!.duration).toBeCloseTo(0.2, 6);
    // The shortcut repeats one rectangle into all four corners.
    expect(sheet.frames![0]!.coords).toEqual([
      [0, 0, 0.5, 1],
      [0, 0, 0.5, 1],
      [0, 0, 0.5, 1],
      [0, 0, 0.5, 1],
    ]);
    expect(sheet.frames![1]!.coords[0]).toEqual([0.5, 0, 1, 1]);
  }, 120_000);

  it.skipIf(!has.gameContent)(
    "edits a particle sheet that already exists in a stock L4D2 texture",
    async () => {
      const vpk = join(ctx.config.gameDir!, "pak01_dir.vpk");
      if (!existsSync(vpk)) return;

      const into = join(scratch, "stock-sheet");
      const extracted = runVpkExtractTool.handler(
        {
          path: vpk,
          into,
          filter: "materials/particle/leaf/leaf.vtf",
          limit: 5,
          confirm: true,
        } as never,
        toolCtx,
      ) as { written: Array<{ file: string }> };
      expect(extracted.written.length).toBeGreaterThan(0);
      const path = extracted.written[0]!.file;

      const before = await readResources(path);
      expect(before.sheetInfo.length).toBeGreaterThan(0);
      const sequences = before.sheetInfo.map((sequence) => ({
        sequence: sequence.sequence,
        clamp: sequence.clamp,
        duration: sequence.duration,
        frames: sequence.frames!.map((frame) => ({
          duration: frame.duration,
          coords: frame.coords,
        })),
      }));
      const result = (await writeVtfParticleSheetTool.handler(
        { path, sequences, backup: true, confirm: true } as never,
        toolCtx,
      )) as { verified: boolean; sequences: number; frames: number };
      expect(result.verified).toBe(true);
      expect(result.sequences).toBe(sequences.length);
      expect(result.frames).toBe(
        sequences.reduce((sum, sequence) => sum + sequence.frames.length, 0),
      );

      const after = await readResources(path);
      expect(after.sheetInfo).toEqual(before.sheetInfo);

      // The same real file has other resources (CRC, LOD); adding a new table entry must
      // shift their offsets without breaking them.
      const tableBefore = readVtfResourceTable(readFileSync(path));
      const rect = {
        minX: 0,
        minY: 0,
        maxX: 4,
        maxY: 4,
        randomRotation: false,
        randomReflection: false,
        alternate: false,
      };
      const hotspot = (await writeVtfHotspotTool.handler(
        { path, rects: [rect], flags: 0, backup: true, confirm: true } as never,
        toolCtx,
      )) as { verified: boolean };
      expect(hotspot.verified).toBe(true);
      const tableAfter = readVtfResourceTable(readFileSync(path));
      expect(tableAfter.count).toBe(tableBefore.count + 1);
      expect((await readResources(path)).hotspotInfo).toEqual([rect]);
      // The image and the unrelated resources are still readable by srctools.
      expect((await readResources(path)).sheetInfo).toEqual(before.sheetInfo);
    },
    120_000,
  );

  it("refuses coordinates the engine cannot sample, and a dry run writes nothing", async () => {
    const path = await makeVtf("refuse");
    const before = readFileSync(path);
    expect(() =>
      writeVtfParticleSheetTool.handler(
        {
          path,
          sequences: [
            {
              sequence: 0,
              clamp: false,
              duration: 1,
              frames: [{ duration: 1, left: 0, top: 0, right: 2, bottom: 1 }],
            },
          ],
          backup: true,
          confirm: true,
        } as never,
        toolCtx,
      ),
    ).toThrow(/outside 0\.\.1/);
    expect(readFileSync(path).equals(before)).toBe(true);

    const dry = (await writeVtfHotspotTool.handler(
      {
        path,
        rects: [
          {
            minX: 0,
            minY: 0,
            maxX: 1,
            maxY: 1,
            randomRotation: false,
            randomReflection: false,
            alternate: false,
          },
        ],
        backup: true,
        dryRun: true,
        confirm: true,
      } as never,
      toolCtx,
    )) as { verified: boolean; written: boolean; backup: string | null };
    expect(dry.verified).toBe(true);
    expect(dry.written).toBe(false);
    expect(dry.backup).toBeNull();
    expect(readFileSync(path).equals(before)).toBe(true);
  }, 120_000);
});
