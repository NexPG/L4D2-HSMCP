/**
 * Particle systems: the stock fire file is the oracle.
 *
 * `fire_medium_01` is a known system with three children and a material; if those survive
 * parsing, the DMX/PCF path is intact. The malformed case must be a reported read error,
 * not a crash: a broken custom `.pcf` is exactly what a map author brings in.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { config, has } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-pcf-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface ReadResult {
  read: boolean;
  fileCount?: number;
  total?: number;
  count?: number;
  problems?: string[];
  systems?: Array<{
    name: string;
    materials: string[];
    children: string[];
    renderers: unknown[];
    initializers: unknown[];
  }>;
  readError?: string;
}

const installed = has.sidecar;

describe.skipIf(!installed)("read_particle", () => {
  it.skipIf(!has.gameContent)("finds fire_medium_01 and its children in the stock file", async () => {
    const read = await callSidecar<ReadResult>(
      "particle_read",
      {
        gameDir: config.gameDir,
        filePattern: "fire_fx",
        includeOperators: false,
        limit: 500,
      },
      config,
      300_000,
    );
    expect(read.read).toBe(true);
    expect(read.fileCount).toBe(1);
    expect(read.total).toBeGreaterThan(20);
    const fire = read.systems!.find((system) => system.name === "fire_medium_01")!;
    expect(fire).toBeDefined();
    expect(fire.children).toContain("embers_medium_01");
    expect(fire.children).toContain("smoke_medium_01");
    expect(fire.materials.some((material) => material.includes("fire_particle"))).toBe(true);
  });

  it("reports a malformed PCF instead of throwing", async () => {
    const path = join(scratch, "broken.pcf");
    writeFileSync(path, Buffer.from("this is not a datamodel"));
    const read = await callSidecar<ReadResult>("particle_read", { path }, config);
    expect(read.read).toBe(false);
    expect(read.readError).toBeTruthy();
  });

  it("writes a new PCF and reads back its systems, children and operators", async () => {
    const path = join(scratch, "new.pcf");
    const written = await callSidecar<{
      written: boolean;
      bytes: number;
      systemCount: number;
      verified: boolean;
    }>(
      "particle_write",
      {
        path,
        systems: [
          {
            name: "smoke_test",
            options: { material: "particle/smoke_test", max_particles: 64 },
            renderers: [
              {
                name: "render",
                function: "render_animated_sprites",
                options: { texture: "particle/smoke_test" },
              },
            ],
            initializers: [
              {
                name: "life",
                function: "init_life_time",
                options: { min_life_time: 1.0, max_life_time: 2.0 },
              },
            ],
            children: ["smoke_child"],
          },
          {
            name: "smoke_child",
            options: { material: "particle/smoke_child" },
          },
        ],
      },
      config,
    );
    expect(written.written).toBe(true);
    expect(written.bytes).toBeGreaterThan(0);
    expect(written.systemCount).toBe(2);
    expect(written.verified).toBe(true);

    const read = await callSidecar<ReadResult>("particle_read", { path }, config);
    expect(read.read).toBe(true);
    expect(read.total).toBe(2);
    const smoke = read.systems!.find((system) => system.name === "smoke_test")!;
    expect(smoke.children).toEqual(["smoke_child"]);
    expect(smoke.materials).toContain("particle/smoke_test");
    expect((smoke.renderers[0] as { function: string }).function).toBe("render_animated_sprites");
    expect((smoke.initializers[0] as { function: string }).function).toBe("init_life_time");
  });

  it("resolves an effect_name and calls a pcf/system path what it is", async () => {
    const path = join(scratch, "effect.pcf");
    await callSidecar(
      "particle_write",
      {
        path,
        systems: [
          {
            name: "smoke_effect",
            options: { material: "particle/smoke_test" },
          },
        ],
      },
      config,
    );

    interface EffectResult {
      effectName?: {
        name: string;
        pathStyle: boolean;
        resolved: boolean;
        matches: Array<{ name: string }>;
        hint?: string;
      };
    }
    const bare = await callSidecar<EffectResult>(
      "particle_read",
      { path, effectName: "smoke_effect", includeOperators: false },
      config,
    );
    expect(bare.effectName?.resolved).toBe(true);
    expect(bare.effectName?.pathStyle).toBe(false);
    expect(bare.effectName?.matches[0]?.name).toBe("smoke_effect");

    const styled = await callSidecar<EffectResult>(
      "particle_read",
      { path, effectName: "effect/smoke_effect", includeOperators: false },
      config,
    );
    expect(styled.effectName?.resolved).toBe(false);
    expect(styled.effectName?.pathStyle).toBe(true);
    expect(styled.effectName?.hint).toContain("bare system name");
  });

  it.skipIf(!has.gameContent)("renames a copied system and its child references", async () => {
    const copy = join(scratch, "renamed.pcf");
    const written = await callSidecar<{
      written: boolean;
      verified: boolean;
      renames?: Record<string, string>;
      systems: Array<{ name: string; children: string[] }>;
    }>(
      "particle_write",
      {
        path: copy,
        source: "particles/fire_01l4d.pcf",
        renames: { fire_barrel_big: "hsmcp_barrel" },
        gameDir: config.gameDir,
      },
      config,
      300_000,
    );
    expect(written.written).toBe(true);
    expect(written.verified).toBe(true);
    expect(written.renames).toEqual({ fire_barrel_big: "hsmcp_barrel" });
    const renamed = written.systems.find((system) => system.name === "hsmcp_barrel");
    expect(renamed, "the renamed parent is missing").toBeDefined();
    expect(renamed!.children).toContain("fire_barrel_big_b");
    expect(written.systems.some((system) => system.name === "fire_barrel_big")).toBe(false);

    await expect(
      callSidecar(
        "particle_write",
        {
          path: join(scratch, "renamed-clash.pcf"),
          source: "particles/fire_01l4d.pcf",
          renames: { fire_barrel_big: "fire_barrel_big_b" },
          gameDir: config.gameDir,
        },
        config,
        300_000,
      ),
    ).rejects.toThrow(/already exists/);
  });
  it.skipIf(!has.gameContent)("rewrites a stock PCF through the writer without losing systems", async () => {
    const copy = join(scratch, "fire_copy.pcf");
    const written = await callSidecar<{
      written: boolean;
      source: string | null;
      systemCount: number;
      verified: boolean;
      warnings: string[];
      childWrappers: number;
      systems: Array<{ name: string; children: string[] }>;
    }>(
      "particle_write",
      {
        path: copy,
        source: "particles/fire_01l4d.pcf",
        gameDir: config.gameDir,
      },
      config,
      300_000,
    );
    expect(written.written).toBe(true);
    expect(written.source).toBe("particles/fire_01l4d.pcf");
    expect(written.systemCount).toBeGreaterThan(20);
    expect(written.verified).toBe(true);
    expect(written.warnings).toEqual([]);
    // The engine reads children as DmeParticleChild wrappers; a direct element reference
    // registers the names but draws nothing.
    expect(written.childWrappers).toBeGreaterThan(0);
    const declaredChildren = written.systems.reduce((n, s) => n + s.children.length, 0);
    expect(written.childWrappers).toBe(declaredChildren);

    const original = await callSidecar<ReadResult>(
      "particle_read",
      { gameDir: config.gameDir, filePattern: "fire_01l4d.pcf", limit: 10_000 },
      config,
      300_000,
    );
    const rewritten = await callSidecar<ReadResult>(
      "particle_read",
      { path: copy, limit: 10_000 },
      config,
      300_000,
    );
    expect(rewritten.total).toBe(original.total);
    const byName = new Map(original.systems!.map((system) => [system.name, system]));
    for (const system of rewritten.systems!) {
      const before = byName.get(system.name);
      expect(before, `system ${system.name} disappeared`).toBeDefined();
      expect(system.children).toEqual(before!.children);
      expect(system.materials).toEqual(before!.materials);
      expect(system.renderers.length).toBe(before!.renderers.length);
      expect(system.initializers.length).toBe(before!.initializers.length);
    }
  });
});
