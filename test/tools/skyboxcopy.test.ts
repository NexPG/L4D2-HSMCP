import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/registry.js";
import { insertSolids } from "../../src/vmf/build.js";
import { checkVmfSolids } from "../../src/vmf/solid.js";
import { writeSkyboxCopyTool } from "../../src/tools/skyboxcopy.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-skyboxcopy-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const EMPTY = 'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

function map(name: string, withCamera = true): string {
  const built = insertSolids(
    EMPTY,
    [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }],
    { material: "BRICK/BRICKWALL001A" },
  ).text;
  const camera = withCamera
    ? 'entity\n{\n\t"id" "99"\n\t"classname" "sky_camera"\n\t"origin" "0 0 10000"\n\t"scale" "16"\n}\n'
    : "";
  const path = join(scratch, name);
  writeFileSync(path, built + camera, "utf8");
  return path;
}

describe("write_skybox_copy", () => {
  it("copies a brush at 1/16 scale and moves it to the camera", async () => {
    const path = map("copy.vmf");
    const before = checkVmfSolids(path, readFileSync(path, "utf8"));
    const id = before.solids[0]!.id!;
    const out = (await writeSkyboxCopyTool.handler(
      {
        path,
        solidIds: [id],
        targetOrigin: [0, 0, 10000],
        scale: 16,
        backup: false,
        dryRun: false,
        confirm: true,
      },
      ctx,
    )) as { written: boolean; cloneIds: number[]; warnings: string[]; solidsAfter: number };

    expect(out.written).toBe(true);
    expect(out.solidsAfter).toBe(before.solidCount + 1);
    const after = checkVmfSolids(path, readFileSync(path, "utf8"));
    const clone = after.solids.find((s) => s.id === out.cloneIds[0])!;
    expect(clone.valid).toBe(true);
    expect(clone.volume).toBeCloseTo(before.solids[0]!.volume / 4096, 3);
    expect(clone.mins[2]).toBeCloseTo(10000, 3);
    expect(out.warnings.some((w) => w.includes("seal"))).toBe(true);
  });

  it("warns when no sky_camera exists", async () => {
    const path = map("no-camera.vmf", false);
    const id = checkVmfSolids(path, readFileSync(path, "utf8")).solids[0]!.id!;
    const out = (await writeSkyboxCopyTool.handler(
      {
        path,
        solidIds: [id],
        targetOrigin: [0, 0, 10000],
        backup: false,
        confirm: true,
      },
      ctx,
    )) as { warnings: string[] };
    expect(out.warnings.some((w) => w.includes("no sky_camera"))).toBe(true);
  });

  it("refuses an empty selector", () => {
    const path = map("empty.vmf");
    expect(() =>
      writeSkyboxCopyTool.handler(
        { path, targetOrigin: [0, 0, 10000], backup: false, confirm: true },
        ctx,
      ),
    ).toThrow(/name the brushes/);
  });
});
