import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import { PRECIPITATION_TYPES, writeWeather } from "../../src/scripts/typescript/tools/weather.js";
import { FIXTURES, ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-weather-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function probe(name: string): string {
  const path = join(scratch, name);
  copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), path);
  return path;
}

describe("write_weather", () => {
  it("adds a checked precipitation volume and a fog controller", async () => {
    const path = probe("rain.vmf");
    const before = checkVmfSolids(path, readFileSync(path, "utf8"));

    const out = (await writeWeather.handler(
      {
        path,
        precipitation: {
          kind: "rain",
          mins: [-256, -256, 0],
          maxs: [256, 256, 256],
          density: 80,
          color: [120, 130, 140],
        },
        fog: {
          enabled: true,
          color: [90, 100, 110],
          start: 400,
          end: 2400,
          maxDensity: 0.8,
          blend: false,
          lerpTime: 0,
        },
        confirm: true,
      },
      ctx,
    )) as {
      precipitationEntityId: number | null;
      solidIds: number[];
      fogEntityId: number | null;
      warnings: string[];
    };

    expect(out.precipitationEntityId).not.toBeNull();
    expect(out.fogEntityId).not.toBeNull();
    expect(out.solidIds).toHaveLength(1);

    const text = readFileSync(path, "utf8");
    expect(text).toContain('"classname" "func_precipitation"');
    expect(text).toContain(`"preciptype" "${PRECIPITATION_TYPES.rain}"`);
    expect(text).toContain('"renderamt" "80"');
    expect(text).toContain('"rendercolor" "120 130 140"');
    expect(text).toContain('"classname" "env_fog_controller"');
    expect(text).toContain('"fogenable" "1"');
    expect(text).toContain('"fogcolor" "90 100 110"');
    expect(text).toContain('"fogstart" "400.0"');
    expect(text).toContain('"fogend" "2400.0"');
    expect(text).toContain('"fogmaxdensity" "0.8"');

    const after = checkVmfSolids(path, text);
    expect(after.solidCount).toBe(before.solidCount + 1);
    const owned = after.solids.filter((s) => s.owner === "func_precipitation");
    expect(owned).toHaveLength(1);
    expect(owned[0]!.valid, owned[0]!.findings.map((f) => f.message).join(" | ")).toBe(true);
    expect(out.warnings.some((w) => w.includes("never drawn"))).toBe(true);
  });

  it("can add fog alone, and disabled fog says so", async () => {
    const path = probe("fog-only.vmf");
    const out = (await writeWeather.handler(
      {
        path,
        fog: {
          enabled: false,
          color: [255, 255, 255],
          start: 100,
          end: 900,
          maxDensity: 1,
          blend: false,
          lerpTime: 0,
        },
        confirm: true,
      },
      ctx,
    )) as { precipitationEntityId: number | null; fogEntityId: number | null; warnings: string[] };

    expect(out.precipitationEntityId).toBeNull();
    expect(out.fogEntityId).not.toBeNull();
    const text = readFileSync(path, "utf8");
    expect(text).toContain('"fogenable" "0"');
    expect(out.warnings.some((w) => w.includes("disabled"))).toBe(true);
  });

  it("refuses a second fog controller", async () => {
    const path = probe("twice.vmf");
    const fog = {
      enabled: true,
      color: [255, 255, 255] as [number, number, number],
      start: 100,
      end: 900,
      maxDensity: 1,
      blend: false,
      lerpTime: 0,
    };
    await writeWeather.handler({ path, fog, confirm: true }, ctx);
    await expect(writeWeather.handler({ path, fog, confirm: true }, ctx)).rejects.toThrow(
      /already has an env_fog_controller/,
    );
  });

  it("refuses an empty volume and inverted fog", async () => {
    const path = probe("bad.vmf");
    await expect(
      writeWeather.handler(
        {
          path,
          precipitation: {
            kind: "snow",
            mins: [0, 0, 0],
            maxs: [0, 64, 64],
            density: 100,
            color: [255, 255, 255],
          },
          confirm: true,
        },
        ctx,
      ),
    ).rejects.toThrow(/empty on the x axis/);

    await expect(
      writeWeather.handler(
        {
          path,
          fog: {
            enabled: true,
            color: [255, 255, 255],
            start: 1000,
            end: 500,
            maxDensity: 1,
            blend: false,
            lerpTime: 0,
          },
          confirm: true,
        },
        ctx,
      ),
    ).rejects.toThrow(/must be past fog start/);
  });

  it("refuses a call that changes nothing", async () => {
    const path = probe("nothing.vmf");
    await expect(writeWeather.handler({ path, confirm: true }, ctx)).rejects.toThrow(
      /nothing to add/,
    );
  });
});
