/**
 * SMD: the source studiomdl compiles.
 *
 * The tests drive the real parser through the sidecar and check the two things a model
 * author depends on: a JSON mesh comes back as the same mesh, and the faults that would
 * otherwise appear as a terse studiomdl error are named here — a triangle with two
 * vertices, a weight set that does not sum to one, a bone nothing declares.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { config, has } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-smd-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const TRIANGLE = [
  { position: [0, 0, 0], normal: [0, 0, 1], uv: [0, 0] },
  { position: [64, 0, 0], normal: [0, 0, 1], uv: [1, 0] },
  { position: [64, 64, 0], normal: [0, 0, 1], uv: [1, 1] },
];

interface ReadResult {
  read: boolean;
  version: number;
  nodes: { id: number; name: string; parent: number }[];
  boneCount: number;
  frameCount: number;
  frameTimes: number[];
  triangleCount: number;
  vertexCount: number;
  materials: { name: string; triangles: number }[];
  mins: number[] | null;
  maxs: number[] | null;
  diagnostics: { severity: string; rule: string; message: string; line: number | null }[];
  ok: boolean;
}

const installed = has.sidecar;

describe.skipIf(!installed)("read_smd / write_smd", () => {
  it("writes a mesh and reads the same mesh back", async () => {
    const path = join(scratch, "crate.smd");
    const write = await callSidecar<{ written: boolean; verified: boolean; triangleCount: number }>(
      "smd_write",
      {
        path,
        nodes: [{ name: "root", parent: null }, { name: "lid", parent: "root" }],
        triangles: [
          { material: "crate", vertices: TRIANGLE },
          {
            material: "crate",
            vertices: TRIANGLE.map((v) => ({
              ...v,
              position: [v.position[0]!, v.position[1]!, v.position[2]! - 8],
            })),
          },
        ],
      },
      config,
    );
    expect(write.written).toBe(true);
    expect(write.verified).toBe(true);
    expect(write.triangleCount).toBe(2);

    const read = await callSidecar<ReadResult>("smd_read", { path }, config);
    expect(read.read).toBe(true);
    expect(read.version).toBe(1);
    expect(read.nodes.map((n) => [n.id, n.name, n.parent])).toEqual([
      [0, "root", -1],
      [1, "lid", 0],
    ]);
    expect(read.frameCount).toBe(1);
    expect(read.triangleCount).toBe(2);
    expect(read.vertexCount).toBe(6);
    expect(read.materials).toEqual([{ name: "crate", triangles: 2 }]);
    expect(read.mins).toEqual([0, 0, -8]);
    expect(read.maxs).toEqual([64, 64, 0]);
    expect(read.diagnostics).toEqual([]);
    expect(read.ok).toBe(true);
  });

  it("reports an unknown bone and weights that do not sum to one", async () => {
    const path = join(scratch, "weights.smd");
    writeFileSync(
      path,
      [
        "version 1",
        "nodes",
        '0 "root" -1',
        "end",
        "skeleton",
        "time 0",
        "0 0 0 0 0 0 0",
        "end",
        "triangles",
        "mat",
        "0 0 0 0 0 0 1 0 0 2 5 0.5 6 0.2",
        "0 1 0 0 0 0 1 0 0 2 5 0.5 6 0.2",
        "0 0 1 0 0 0 1 0 0 2 5 0.5 6 0.2",
        "end",
      ].join("\n"),
      "utf8",
    );
    const read = await callSidecar<ReadResult>("smd_read", { path }, config);
    const rules = read.diagnostics.map((d) => d.rule);
    expect(rules).toContain("weight-sum");
    expect(rules).toContain("bone-unknown");
    expect(read.diagnostics.every((d) => d.severity === "warning")).toBe(true);
  });

  it("turns a two-vertex triangle into an error instead of repairing it", async () => {
    const path = join(scratch, "short.smd");
    writeFileSync(
      path,
      [
        "version 1",
        "nodes",
        '0 "root" -1',
        "end",
        "skeleton",
        "time 0",
        "0 0 0 0 0 0 0",
        "end",
        "triangles",
        "mat",
        "0 0 0 0 0 0 1 0 0 1 0 1.0",
        "0 1 0 0 0 0 1 0 0 1 0 1.0",
        "end",
      ].join("\n"),
      "utf8",
    );
    const read = await callSidecar<ReadResult>("smd_read", { path }, config);
    expect(read.ok).toBe(false);
    expect(read.diagnostics.map((d) => d.rule)).toContain("triangle-incomplete");
  });

  it("refuses a duplicate bone name when writing", async () => {
    await expect(
      callSidecar(
        "smd_write",
        {
          path: join(scratch, "dup.smd"),
          nodes: [{ name: "root", parent: null }, { name: "root", parent: null }],
          triangles: [{ material: "m", vertices: TRIANGLE }],
        },
        config,
      ),
    ).rejects.toThrow(/appears twice/);
  });
});
