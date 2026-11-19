/**
 * FBX -> SMD, against files built byte by byte in the test.
 *
 * The binary writer below is the smallest thing that produces the real 7.4 layout: a record
 * has an absolute end offset, a property count and a property byte length, and arrays are
 * zlib-deflated with a count/encoding/length header. Writing it here rather than committing
 * a binary fixture means the test says what it believes the format is, and a reader change
 * that only agrees with the writer is not enough: the expectations below are geometry and
 * skin weights, not parser internals.
 *
 * The cases that matter: a static triangle with UVs and material, a Y-up file, a two-bone
 * skin whose bind pose comes from `TransformLink`, and the ASCII encoding. Units and the
 * animation/blend-shape omissions are checked as reports, because they are the places a
 * silent import would look successful.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readModelInfoTool } from "../../src/assets/typescript/tools/content.js";
import { fbxToSmdTool, readFbxTool } from "../../src/models/typescript/tools/fbx.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { config, ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

/** The tool's schema defaults are applied by the MCP layer, not by a direct handler call. */
function convert(path: string, out: string) {
  return fbxToSmdTool.handler(
    {
      path,
      output: out,
      axis: "auto",
      scale: 1,
      useNodeTransforms: true,
      flipV: true,
      models: [],
      material: "debug/debugempty",
      limitVertices: 2_000_000,
      overwrite: false,
      confirm: true,
    },
    ctx,
  );
}

const scratch = mkdtempSync(join(tmpdir(), "hammer-fbx-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const MAGIC = Buffer.from("Kaydara FBX Binary  \x00\x1a\x00", "binary");
const VERSION = 7400;

interface Value {
  bytes: Buffer;
}

const str = (value: string): Value => {
  const text = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(text.length);
  return { bytes: Buffer.concat([Buffer.from("S"), length, text]) };
};
const i32 = (value: number): Value => {
  const body = Buffer.alloc(5);
  body[0] = 0x49; // I
  body.writeInt32LE(value, 1);
  return { bytes: body };
};
const i64 = (value: number): Value => {
  const body = Buffer.alloc(9);
  body[0] = 0x4c; // L
  body.writeBigInt64LE(BigInt(value), 1);
  return { bytes: body };
};
const f64 = (value: number): Value => {
  const body = Buffer.alloc(9);
  body[0] = 0x44; // D
  body.writeDoubleLE(value, 1);
  return { bytes: body };
};
const doubles = (values: number[]): Value => {
  const payload = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => payload.writeDoubleLE(value, index * 8));
  const header = Buffer.alloc(13);
  header[0] = 0x64; // d
  header.writeUInt32LE(values.length, 1);
  header.writeUInt32LE(1, 5);
  header.writeUInt32LE(deflateSync(payload).length, 9);
  return { bytes: Buffer.concat([header, deflateSync(payload)]) };
};
const ints = (values: number[]): Value => {
  const payload = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => payload.writeInt32LE(value, index * 4));
  const header = Buffer.alloc(13);
  header[0] = 0x69; // i
  header.writeUInt32LE(values.length, 1);
  header.writeUInt32LE(1, 5);
  header.writeUInt32LE(deflateSync(payload).length, 9);
  return { bytes: Buffer.concat([header, deflateSync(payload)]) };
};

class Binary {
  private readonly parts: Buffer[] = [];
  private readonly patches: Array<{ at: number; end: number; count: number; props: number }> = [];
  private offset = 0;

  add(buffer: Buffer): void {
    this.parts.push(buffer);
    this.offset += buffer.length;
  }

  node(name: string, props: Value[], children: Array<(writer: Binary) => void>): void {
    const start = this.offset;
    this.add(Buffer.alloc(12));
    const nameBuffer = Buffer.from(name, "utf8");
    this.add(Buffer.from([nameBuffer.length]));
    this.add(nameBuffer);
    const propBuffer = Buffer.concat(props.map((prop) => prop.bytes));
    this.add(propBuffer);
    for (const child of children) child(this);
    if (children.length > 0) this.add(Buffer.alloc(13));
    this.patches.push({ at: start, end: this.offset, count: props.length, props: propBuffer.length });
  }

  finish(): Buffer {
    const all = Buffer.concat([MAGIC, (() => {
      const version = Buffer.alloc(4);
      version.writeUInt32LE(VERSION);
      return version;
    })(), ...this.parts, Buffer.alloc(13)]);
    // Patches were recorded relative to the node stream; the magic and version precede it.
    const prefix = MAGIC.length + 4;
    for (const patch of this.patches) {
      all.writeUInt32LE(patch.end + prefix, patch.at + prefix);
      all.writeUInt32LE(patch.count, patch.at + prefix + 4);
      all.writeUInt32LE(patch.props, patch.at + prefix + 8);
    }
    return all;
  }
}

/** A `P` record for `Properties70`. */
function property(name: string, type: string, subtype: string, value: Value) {
  return (writer: Binary) => writer.node("P", [str(name), str(type), str(subtype), str("A"), value], []);
}

/** A three-number `P` record, which is what a transform property actually is. */
function vector(name: string, value: [number, number, number]) {
  return (writer: Binary) =>
    writer.node(
      "P",
      [str(name), str(name), str(""), str("A"), f64(value[0]), f64(value[1]), f64(value[2])],
      [],
    );
}

function header(writer: Binary, upAxis: number, unit: number): void {
  writer.node("FBXHeaderExtension", [], [
    () => writer.node("FBXVersion", [i32(VERSION)], []),
  ]);
  writer.node("GlobalSettings", [], [
    () => writer.node("Properties70", [], [
      property("UpAxis", "int", "Integer", i32(upAxis)),
      property("UnitScaleFactor", "double", "Number", f64(unit)),
    ]),
  ]);
}

function connection(writer: Binary, child: number, parent: number): void {
  writer.node("C", [str("OO"), i64(child), i64(parent)], []);
}

/** A triangle with normals, UVs and one material, at `translation`. */
function staticTriangle(upAxis: number, translation: [number, number, number], unit = 1): Buffer {
  const writer = new Binary();
  header(writer, upAxis, unit);
  writer.node("Objects", [], [
    () =>
      writer.node("Geometry", [i64(100), str("Geometry::tri"), str("Mesh")], [
        () => writer.node("Vertices", [doubles([0, 0, 0, 64, 0, 0, 0, 64, 0])], []),
        () => writer.node("PolygonVertexIndex", [ints([0, 1, -3])], []),
        () =>
          writer.node("LayerElementNormal", [], [
            () => writer.node("MappingInformationType", [str("ByPolygonVertex")], []),
            () => writer.node("ReferenceInformationType", [str("Direct")], []),
            () => writer.node("Normals", [doubles([0, 0, 1, 0, 0, 1, 0, 0, 1])], []),
          ]),
        () =>
          writer.node("LayerElementUV", [], [
            () => writer.node("MappingInformationType", [str("ByPolygonVertex")], []),
            () => writer.node("ReferenceInformationType", [str("Direct")], []),
            () => writer.node("UV", [doubles([0, 0, 1, 0, 0, 1])], []),
          ]),
        () =>
          writer.node("LayerElementMaterial", [], [
            () => writer.node("MappingInformationType", [str("ByPolygon")], []),
            () => writer.node("Materials", [ints([0])], []),
          ]),
      ]),
    () =>
      writer.node("Model", [i64(200), str("Model::tri"), str("Mesh")], [
        () =>
          writer.node("Properties70", [], [
            vector("Lcl Translation", translation),
          ]),
      ]),
    () => writer.node("Material", [i64(300), str("Material::wood"), str("")], []),
  ]);
  writer.node("Connections", [], [
    () => connection(writer, 100, 200),
    () => connection(writer, 300, 200),
  ]);
  return writer.finish();
}

/** Two LimbNode bones, a skinned triangle and a cluster binding bone 201. */
function skinnedTriangle(): Buffer {
  const writer = new Binary();
  header(writer, 2, 1);
  const bind = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    10, 0, 0, 1,
  ];
  writer.node("Objects", [], [
    () =>
      writer.node("Geometry", [i64(100), str("Geometry::skin"), str("Mesh")], [
        () => writer.node("Vertices", [doubles([0, 0, 0, 64, 0, 0, 0, 64, 0])], []),
        () => writer.node("PolygonVertexIndex", [ints([0, 1, -3])], []),
        () =>
          writer.node("LayerElementUV", [], [
            () => writer.node("MappingInformationType", [str("ByPolygonVertex")], []),
            () => writer.node("ReferenceInformationType", [str("Direct")], []),
            () => writer.node("UV", [doubles([0, 0, 1, 0, 0, 1])], []),
          ]),
      ]),
    () => writer.node("Model", [i64(200), str("Model::Root"), str("LimbNode")], []),
    () =>
      writer.node("Model", [i64(201), str("Model::Bone"), str("LimbNode")], [
        () =>
          writer.node("Properties70", [], [
            vector("Lcl Translation", [10, 0, 0]),
          ]),
      ]),
    () => writer.node("Model", [i64(202), str("Model::Arm"), str("Mesh")], []),
    () => writer.node("Material", [i64(300), str("Material::skinmat"), str("")], []),
    () =>
      writer.node("Deformer", [i64(400), str("Deformer::Skin"), str("Skin")], [
        () => writer.node("Indexes", [ints([0, 1, 2])], []),
      ]),
    () =>
      writer.node("Deformer", [i64(401), str("SubDeformer::Cluster"), str("Cluster")], [
        () => writer.node("Indexes", [ints([0, 1, 2])], []),
        () => writer.node("Weights", [doubles([1, 0.5, 0.5])], []),
        () => writer.node("TransformLink", [doubles(bind)], []),
      ]),
  ]);
  writer.node("Connections", [], [
    () => connection(writer, 100, 202),
    () => connection(writer, 300, 202),
    () => connection(writer, 201, 200),
    () => connection(writer, 400, 100),
    () => connection(writer, 401, 400),
    // A real cluster has two connections: to the skin and to the bone it belongs to.
    () => connection(writer, 401, 201),
  ]);
  return writer.finish();
}

const ASCII = `
; a minimal ASCII FBX
FBXHeaderExtension:  {
    FBXHeaderVersion: 1003
    FBXVersion: 7400
}
GlobalSettings:  {
    Properties70:  {
        P: "UpAxis", "int", "Integer", "A", 2
        P: "UnitScaleFactor", "double", "Number", "A", 1
    }
}
Objects:  {
    Geometry: 100, "Geometry::ascii", "Mesh" {
        Vertices: *9 {
            a: 0,0,0,32,0,0,0,32,0
        }
        PolygonVertexIndex: *3 {
            a: 0,1,-3
        }
    }
    Model: 200, "Model::ascii", "Mesh" {
        Properties70:  {
            P: "Lcl Translation", "Lcl Translation", "", "A",0,0,5
        }
    }
    Material: 300, "Material::stone", "" {
    }
}
Connections:  {
    C: "OO",100,200
    C: "OO",300,200
}
`;

describe.skipIf(!has.sidecar)("FBX", () => {
  it("reads a binary file's inventory without converting it", async () => {
    const path = join(scratch, "static.fbx");
    writeFileSync(path, staticTriangle(2, [0, 0, 0]));
    const probe = readFileSync(path);
    const read = (await readFbxTool.handler({ path }, ctx)) as {
      format: string;
      version: number;
      upAxis: number;
      unitScaleFactor: number;
      counts: { geometries: number; materials: number };
      geometries: Array<{ vertices: number; triangles: number; hasNormals: boolean; hasUVs: boolean }>;
      materials: string[];
      diagnostics: Array<{ rule: string }>;
    };
    expect(read.format).toBe("binary");
    expect(read.version).toBe(7400);
    expect(read.upAxis).toBe(2);
    expect(read.unitScaleFactor).toBe(1);
    expect(read.geometries[0]).toMatchObject({ vertices: 3, triangles: 1, hasNormals: true, hasUVs: true });
    expect(read.materials).toEqual(["wood"]);
    expect(read.diagnostics.map((d) => d.rule)).not.toContain("fbx-no-geometry");
  });

  it("writes a triangle with placement, flipped V and the connected material", async () => {
    const path = join(scratch, "static.fbx");
    writeFileSync(path, staticTriangle(2, [10, 0, 0]));
    const out = join(scratch, "static.smd");
    const result = (await convert(path, out)) as { counts: { triangles: number; bones: number }; materials: string[] };
    expect(result.counts.triangles).toBe(1);
    expect(result.counts.bones).toBe(1);
    expect(result.materials).toEqual(["wood"]);

    const smd = readFileSync(out, "utf8");
    expect(smd).toContain('"tri"');
    expect(smd).toContain("wood");
    // Lcl Translation moves the mesh, and SMD's V inversion is cancelled.
    expect(smd).toContain("10.000000 0.000000 0.000000");
    expect(smd).toContain("74.000000 0.000000 0.000000");
    expect(smd).toMatch(/0\.000000 1\.000000/);
  });

  it("applies the file's Y-up axis to a Z-up target", async () => {
    const path = join(scratch, "yup.fbx");
    // UpAxis 1 (Y-up): the vertex at +10 Y must become +10 Z.
    const writer = new Binary();
    header(writer, 1, 1);
    writer.node("Objects", [], [
      () =>
        writer.node("Geometry", [i64(100), str("Geometry::up"), str("Mesh")], [
          () => writer.node("Vertices", [doubles([0, 0, 0, 10, 0, 0, 0, 10, 0])], []),
          () => writer.node("PolygonVertexIndex", [ints([0, 1, -3])], []),
        ]),
      () => writer.node("Model", [i64(200), str("Model::up"), str("Mesh")], []),
    ]);
    writer.node("Connections", [], [() => connection(writer, 100, 200)]);
    writeFileSync(path, writer.finish());
    const out = join(scratch, "yup.smd");
    const result = (await convert(path, out)) as {
      axis: string;
      bounds: { mins: number[]; maxs: number[] };
    };
    expect(result.axis).toBe("y");
    expect(result.bounds.maxs[2]).toBeCloseTo(10, 5);
  });

  it("takes the bind pose from TransformLink and normalises skin weights", async () => {
    const path = join(scratch, "skin.fbx");
    writeFileSync(path, skinnedTriangle());
    const out = join(scratch, "skin.smd");
    const result = (await convert(path, out)) as {
      nodes: Array<{ name: string; parent: number | null }>;
      counts: { bones: number };
      diagnostics: Array<{ rule: string }>;
    };
    expect(result.nodes.map((node) => node.name)).toEqual(["Root", "Bone"]);
    expect(result.nodes[1]!.parent).toBe(0);
    expect(result.counts.bones).toBe(2);
    expect(result.diagnostics.map((d) => d.rule)).not.toContain("fbx-unweighted");

    const smd = readFileSync(out, "utf8");
    // The child bone sits 10 units from the root in its bind pose.
    expect(smd).toContain("10.000000 0.000000 0.000000");
    // Every triangle vertex links to bone 1; the 0.5 weights are normalised.
    expect(smd.match(/ 1 1 1\.000000/g)?.length).toBe(3);
  });

  it("reads and converts an ASCII file", async () => {
    const path = join(scratch, "ascii.fbx");
    writeFileSync(path, ASCII);
    const read = (await readFbxTool.handler({ path }, ctx)) as { format: string; counts: { geometries: number } };
    expect(read.format).toBe("ascii");
    expect(read.counts.geometries).toBe(1);

    const out = join(scratch, "ascii.smd");
    const result = (await convert(path, out)) as {
      materials: string[];
      bounds: { maxs: number[] };
    };
    expect(result.materials).toEqual(["stone"]);
    expect(result.bounds.maxs[2]).toBeCloseTo(5, 5);
  });

  it("reports units, animations and blend shapes instead of hiding them", async () => {
    const path = join(scratch, "reports.fbx");
    const writer = new Binary();
    header(writer, 2, 100);
    writer.node("Objects", [], [
      () =>
        writer.node("Geometry", [i64(100), str("Geometry::g"), str("Mesh")], [
          () => writer.node("Vertices", [doubles([0, 0, 0, 1, 0, 0, 0, 1, 0])], []),
          () => writer.node("PolygonVertexIndex", [ints([0, 1, -3])], []),
        ]),
      () => writer.node("Model", [i64(200), str("Model::g"), str("Mesh")], []),
      () => writer.node("AnimationStack", [i64(500), str("AnimStack::Take")], []),
      () => writer.node("Deformer", [i64(600), str("Deformer::Morph"), str("BlendShape")], []),
    ]);
    writer.node("Connections", [], [() => connection(writer, 100, 200)]);
    writeFileSync(path, writer.finish());
    const out = join(scratch, "reports.smd");
    const result = (await convert(path, out)) as {
      unitScaleFactor: number;
      animations: string[];
      diagnostics: Array<{ rule: string }>;
    };
    expect(result.unitScaleFactor).toBe(100);
    expect(result.animations).toEqual(["Take"]);
    const rules = result.diagnostics.map((d) => d.rule);
    expect(rules).toContain("fbx-units");
    expect(rules).toContain("fbx-animations");
    expect(rules).toContain("fbx-blend-shapes");
  });

  it(
    "compiles the converted SMD with the game's own compiler",
    async () => {
      if (!has.toolchain) return;
      const dir = join(scratch, "compile");
      const path = join(dir, "compile.fbx");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, staticTriangle(2, [0, 0, 0]));
      const qc = join(dir, "compile.qc");
      const unique = `hsmcp_fbx_test_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
      let compiledModel: string | null = null;
      try {
        const converted = (await fbxToSmdTool.handler(
          {
            path,
            output: join(dir, "compile.smd"),
            axis: "auto",
            scale: 1,
            useNodeTransforms: true,
            flipV: true,
            models: [],
            material: "debug/debugempty",
            limitVertices: 2_000_000,
            qc: {
              path: qc,
              // No `models/`: studiomdl adds the game's models/ directory itself.
              modelname: `${unique}/probe.mdl`,
              cdmaterials: [`models/${unique}`],
              surfaceprop: "metal",
              staticprop: true,
              sequence: "idle",
              fps: 30,
              overwrite: false,
            },
            overwrite: false,
            confirm: true,
          },
          ctx,
        )) as { qc: { diagnostics: Array<{ severity: string }> } };
        expect(converted.qc.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

        const compile = (await runStudiomdlTool.handler(
          { qc, timeoutMinutes: 2, confirm: true },
          ctx,
        )) as {
          ok: boolean;
          modelExists: boolean;
          model: string | null;
          warning: string | null;
          files: Array<{ name: string }>;
        };
        compiledModel = compile.model;
        expect(compile.warning).toBeNull();
        expect(compile.ok).toBe(true);
        expect(compile.modelExists).toBe(true);
        expect(compile.files.map((file) => file.name)).toEqual(
          expect.arrayContaining(["probe.mdl", "probe.vvd", "probe.dx90.vtx"]),
        );

        const info = (await readModelInfoTool.handler(
          { model: `models/${unique}/probe.mdl` },
          ctx,
        )) as { found: boolean; size: number[] | null; boneCount: number };
        expect(info.found).toBe(true);
        expect(info.size![0]).toBeGreaterThanOrEqual(64);
        expect(info.size![1]).toBeGreaterThanOrEqual(64);
        expect(info.boneCount).toBeGreaterThanOrEqual(1);
      } finally {
        const folder = compiledModel
          ? dirname(compiledModel)
          : config.gameDir
            ? join(config.gameDir, "models", unique)
            : null;
        if (folder && existsSync(folder) && folder.toLowerCase().includes(unique.toLowerCase())) {
          rmSync(folder, { recursive: true, force: true });
        }
      }
    },
    120_000,
  );

  it("refuses a file with no mesh instead of writing an empty SMD", async () => {
    const path = join(scratch, "empty.fbx");
    const writer = new Binary();
    header(writer, 2, 1);
    writer.node("Objects", [], []);
    writeFileSync(path, writer.finish());
    const read = (await readFbxTool.handler({ path }, ctx)) as { diagnostics: Array<{ rule: string }> };
    expect(read.diagnostics.map((d) => d.rule)).toContain("fbx-no-geometry");
    await expect(
      convert(path, join(scratch, "empty.smd")),
    ).rejects.toThrow(/no mesh model/);
  });
});
