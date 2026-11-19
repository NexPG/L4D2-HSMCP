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
});
