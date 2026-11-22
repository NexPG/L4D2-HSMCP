import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readBspOverlaysTool, writeBspOverlayTool } from "../../src/maps/typescript/tools/overlays.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const map = (): string => join(ctx.config.gameDir!, "maps", "c1m1_hotel.bsp");
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-overlays-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Overlay {
  id: number;
  texinfo: number;
  texdata: number;
  material: string;
  faceCount: number;
  faces: number[];
  u: [number, number];
  v: [number, number];
  uvPoints: Array<[number, number, number]>;
  origin: [number, number, number];
  normal: [number, number, number];
}

interface OverlayReply {
  recordBytes: number;
  count: number;
  withFaces: number;
  returned: number;
  overlays: Overlay[];
}

async function read(path: string): Promise<OverlayReply> {
  return (await readBspOverlaysTool.handler(
    { path, limit: 500, faceLimit: 4 } as never,
    ctx,
  )) as unknown as OverlayReply;
}

describe.skipIf(!has.gameContent)("read_bsp_overlays", () => {
  it("decodes compiled overlay records with faces, material and UV basis", async () => {
    const r = await read(map());
    expect(r.recordBytes).toBe(352);
    expect(r.count).toBeGreaterThan(0);
    expect(r.withFaces).toBeGreaterThan(0);
    expect(r.returned).toBeGreaterThan(0);
    const overlay = r.overlays.find((entry) => entry.material !== "")!;
    expect(overlay).toBeDefined();
    expect(overlay.material).toMatch(/^decals\//i);
    expect(overlay.faceCount).toBeGreaterThan(0);
    expect(overlay.faces.length).toBeGreaterThan(0);
    expect(overlay.faces.length).toBeLessThanOrEqual(4);
    expect(overlay.uvPoints).toHaveLength(4);
    expect(overlay.u).toHaveLength(2);
    expect(overlay.v).toHaveLength(2);
    expect(overlay.origin).toHaveLength(3);
    expect(overlay.normal).toHaveLength(3);
  });
});

describe.skipIf(!has.gameContent)("write_bsp_overlay", () => {
  it("patches one record in place and writes a copy without touching the source", async () => {
    const source = map();
    const path = join(scratch, "overlay.bsp");
    copyFileSync(source, path);
    const beforeBytes = statSync(path).size;
    const before = await read(path);
    const overlay = before.overlays.find((entry) => entry.material !== "")!;
    const origin: [number, number, number] = [
      overlay.origin[0] + 16,
      overlay.origin[1],
      overlay.origin[2],
    ];

    const written = writeBspOverlayTool.handler(
      { path, overlay: overlay.id, origin, confirm: true, backup: true } as never,
      ctx,
    ) as {
      written: boolean;
      verified: boolean;
      backupPath: string | null;
      bytes: number;
      after: { origin: [number, number, number] };
    };
    expect(written.written).toBe(true);
    expect(written.verified).toBe(true);
    expect(written.backupPath).not.toBeNull();
    expect(written.bytes).toBe(beforeBytes);
    expect(written.after.origin).toEqual(origin);

    const after = await read(path);
    const changed = after.overlays.find((entry) => entry.id === overlay.id)!;
    expect(changed.origin).toEqual(origin);
    expect(changed.u).toEqual(overlay.u);

    // An out copy leaves the in-place source byte-identical.
    const sourceBytes = readFileSync(path);
    const out = join(scratch, "overlay-out.bsp");
    const u: [number, number] = [overlay.u[0] + 0.5, overlay.u[1]];
    const copied = writeBspOverlayTool.handler(
      { path, out, overlay: overlay.id, u, confirm: true } as never,
      ctx,
    ) as { written: boolean; verified: boolean; out: string };
    expect(copied.written).toBe(true);
    expect(copied.verified).toBe(true);
    expect(readFileSync(path).equals(sourceBytes)).toBe(true);
    const outRead = await read(copied.out);
    expect(outRead.overlays.find((entry) => entry.id === overlay.id)!.u).toEqual(u);
  });

  it("refuses an overlay id that is not in the file", () => {
    const path = join(scratch, "overlay-missing.bsp");
    copyFileSync(map(), path);
    expect(() =>
      writeBspOverlayTool.handler(
        { path, overlay: 999_999, origin: [0, 0, 0], confirm: true } as never,
        ctx,
      ),
    ).toThrow(/is not in/);
  });
});
