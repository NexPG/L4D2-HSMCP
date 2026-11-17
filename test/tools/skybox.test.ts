import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/registry.js";
import { writeSkyCamera } from "../../src/tools/skybox.js";
import { FIXTURES, ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-skybox-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("write_sky_camera", () => {
  it("adds one sky_camera with its scale", async () => {
    const path = join(scratch, "sky.vmf");
    copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), path);

    const out = (await writeSkyCamera.handler(
      { path, origin: [0, 0, 0], scale: 16, angles: "0 0 0", confirm: true },
      ctx,
    )) as { entityId: number | null; warnings: string[] };

    expect(out.entityId).not.toBeNull();
    const read = readFileSync(path, "utf8");
    expect(read).toContain('"classname" "sky_camera"');
    expect(read).toContain('"scale" "16"');
  });

  it("refuses a second sky_camera", async () => {
    const path = join(scratch, "sky2.vmf");
    copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), path);
    await writeSkyCamera.handler(
      { path, origin: [0, 0, 0], scale: 16, angles: "0 0 0", confirm: true },
      ctx,
    );
    await expect(
      writeSkyCamera.handler(
        { path, origin: [10, 10, 10], scale: 16, angles: "0 0 0", confirm: true },
        ctx,
      ),
    ).rejects.toThrow(/already has a sky_camera/);
  });
});
