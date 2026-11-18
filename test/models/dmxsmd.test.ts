/**
 * DMX mesh → SMD, built from a datamodel this suite writes itself.
 *
 * The tree is deliberate: two triangles, a material path with `materials/` and `.vmt`, a
 * non-zero scale and `flipVCoordinates: true`. The SMD reader then proves the geometry,
 * the material stripping and the UV flip in one pass. The negative case — a DMX with no
 * mesh — must say so rather than write an empty SMD.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { config, has } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-dmxsmd-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const VERTEX_DATA = {
  name: "bind",
  type: "DmeVertexData",
  attributes: {
    positions: { type: "vector3", array: true, values: [[0, 0, 0], [64, 0, 0], [64, 64, 0]] },
    positionsIndices: { type: "int", array: true, values: [0, 1, 2, 0, 2, 1] },
    normals: { type: "vector3", array: true, values: [[0, 0, 1], [0, 0, 1], [0, 0, 1]] },
    normalsIndices: { type: "int", array: true, values: [0, 1, 2, 0, 2, 1] },
    textureCoordinates: { type: "vector2", array: true, values: [[0, 0], [1, 0], [1, 1]] },
    textureCoordinatesIndices: { type: "int", array: true, values: [0, 1, 2, 0, 2, 1] },
    flipVCoordinates: { type: "bool", value: true },
    jointCount: { type: "int", value: 1 },
  },
} as const;

const MATERIAL = {
  name: "mat_a",
  type: "DmeMaterial",
  attributes: {
    name: { type: "string", value: "mat_a" },
    mtlName: { type: "string", value: "materials/models/probe/mat_a.vmt" },
  },
} as const;

const FACE_SET = {
  name: "mat_a",
  type: "DmeFaceSet",
  attributes: {
    faces: { type: "int", array: true, values: [0, 1, 2, -1, 3, 4, 5, -1] },
    material: { type: "element", value: MATERIAL },
  },
} as const;

function scene(mesh: boolean) {
  const children = mesh
    ? [
        {
          name: "body",
          type: "DmeMesh",
          attributes: {
            name: { type: "string", value: "body" },
            visible: { type: "bool", value: true },
            currentState: { type: "element", value: VERTEX_DATA },
            bindState: { type: "element", value: VERTEX_DATA },
            faceSets: { type: "element", array: true, values: [FACE_SET] },
          },
        },
      ]
    : [];
  return {
    name: "root",
    type: "DmElement",
    attributes: {
      model: {
        type: "element",
        value: {
          name: "scene",
          type: "DmeModel",
          attributes: {
            name: { type: "string", value: "scene" },
            children: { type: "element", array: true, values: children },
          },
        },
      },
    },
  };
}

interface SmdRead {
  triangleCount: number;
  materials: { name: string; triangles: number }[];
  triangles?: {
    material: string;
    vertices: { position: number[]; uv: number[]; links: { bone: number; weight: number }[] }[];
  }[];
}

const installed = has.sidecar;

describe.skipIf(!installed)("dmx_to_smd", () => {
  it("converts geometry, strips the material path and applies scale and V-flip", async () => {
    const dmx = join(scratch, "probe.dmx");
    const smd = join(scratch, "probe.smd");
    await callSidecar("dmx_write", { path: dmx, tree: scene(true) }, config);

    const converted = await callSidecar<{
      meshes: number;
      triangles: number;
      materials: { name: string }[];
      verified: boolean;
      warnings: string[];
    }>("dmx_to_smd", { path: dmx, out: smd, scale: 2, flipV: true }, config);

    expect(converted.meshes).toBe(1);
    expect(converted.triangles).toBe(2);
    expect(converted.materials.map((m) => m.name)).toEqual(["models/probe/mat_a"]);
    expect(converted.verified).toBe(true);
    expect(converted.warnings).toEqual([]);

    const read = await callSidecar<SmdRead>("smd_read", { path: smd, includeTriangles: true }, config);
    expect(read.triangleCount).toBe(2);
    expect(read.materials).toEqual([{ name: "models/probe/mat_a", triangles: 2 }]);

    const first = read.triangles![0]!.vertices[0]!;
    expect(first.position).toEqual([0, 0, 0]);
    // flipVCoordinates true: v = 1 - 0.
    expect(first.uv).toEqual([0, 1]);
    expect(first.links).toEqual([{ bone: 0, weight: 1 }]);

    const second = read.triangles![0]!.vertices[1]!;
    // scale 2 applies after the transform.
    expect(second.position[0]).toBe(128);
  });

  it("refuses a datamodel with no mesh instead of writing an empty SMD", async () => {
    const dmx = join(scratch, "empty.dmx");
    await callSidecar("dmx_write", { path: dmx, tree: scene(false) }, config);
    await expect(
      callSidecar("dmx_to_smd", { path: dmx, out: join(scratch, "empty.smd") }, config),
    ).rejects.toThrow(/no DmeMesh/);
  });
});
