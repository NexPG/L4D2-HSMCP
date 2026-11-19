/**
 * A VMF brush -> a compiled-model source. The Propper++ path, without the plugin.
 *
 * A brush is already a closed convex volume made of planes, and `solid.ts` can rebuild its
 * corners and per-face loops from those planes. What was missing is the step from a face
 * loop to a model source: triangulate it, take the texture axes the mapper already set,
 * shift the origin where a prop wants it, and write the SMD/QC the compiler reads.
 *
 * Three things are deliberate:
 *
 * * **The face loop is the brush's own geometry.** `checkVmfSolids` reports the hull
 *   corners on each plane; `orderedLoop` puts them in winding order. No clipping code is
 *   reimplemented here, so a brush that the oracle calls valid cannot become a different
 *   shape on the way to the model.
 * * **UVs come from `uaxis`/`vaxis`, divided by the texture size.** VMF stores the axes in
 *   world units and the offset in texels; SMD stores normalised UVs. `textureSize` is the
 *   one fact a VMF does not carry, so it is an explicit input (512 by default) rather than
 *   a silent guess. `flipV` cancels studiomdl's parse-time V inversion.
 * * **Collision defaults to the brush itself.** A single brush is convex, so it needs no
 *   `$concave`; several brushes are marked concave. A box remains available for a prop
 *   whose visual mesh is too detailed for physics.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative } from "node:path";
import { z } from "zod";
import { buildQc, loadQc, qcModelName } from "../../../formats/typescript/formats/qc.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";
import { checkVmfSolids, orderedLoop } from "../../../maps/typescript/vmf/solid.js";
import type { SolidCheck, Vec3 } from "../../../maps/typescript/vmf/solid.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const round6 = (v: number): number => {
  const rounded = Math.round(v * 1e6) / 1e6;
  // `Math.round(-0.0000001)` is `-0`; it prints as 0 but is not `Object.is(0)`, and a
  // caller comparing bounds should not see a sign that means nothing.
  return rounded === 0 ? 0 : rounded;
};

interface MaterialInfo {
  /** Normalised path relative to `materials/`, e.g. `brick/brickwall003a`. */
  full: string;
  /** Directory with a trailing slash, or empty for a root material. */
  dir: string;
  /** Name written into the SMD (the directory is in `$cdmaterials`). */
  smd: string;
}

function materialInfo(raw: string, fallback: string): MaterialInfo {
  let value = raw.trim().replace(/\\/g, "/");
  value = value.replace(/^materials\//i, "").replace(/\.vmt$/i, "").toLowerCase();
  if (!value) value = fallback;
  const slash = value.lastIndexOf("/");
  return slash < 0
    ? { full: value, dir: "", smd: value }
    : { full: value, dir: value.slice(0, slash + 1), smd: value.slice(slash + 1) };
}

function qcRelative(fromDir: string, file: string): string {
  const rel = relative(fromDir, file);
  if (isAbsolute(rel)) {
    throw new Error(`${file} is on a different drive from the QC; a QC cannot name it`);
  }
  return rel.replace(/\\/g, "/") || basename(file);
}

interface TriangleVertex {
  position: [number, number, number];
  normal: [number, number, number];
  uv: [number, number];
  links: Array<{ bone: number; weight: number }>;
}

interface Triangle {
  material: string;
  vertices: TriangleVertex[];
}

function boxTriangles(
  minimum: Vec3,
  maximum: Vec3,
  material: string,
): Triangle[] {
  const [x0, y0, z0] = minimum;
  const [x1, y1, z1] = maximum;
  const v000: Vec3 = [x0, y0, z0];
  const v100: Vec3 = [x1, y0, z0];
  const v110: Vec3 = [x1, y1, z0];
  const v010: Vec3 = [x0, y1, z0];
  const v001: Vec3 = [x0, y0, z1];
  const v101: Vec3 = [x1, y0, z1];
  const v111: Vec3 = [x1, y1, z1];
  const v011: Vec3 = [x0, y1, z1];
  const faces: Array<{ normal: Vec3; corners: Array<[Vec3, Vec3, Vec3]> }> = [
    { normal: [0, 0, -1], corners: [[v000, v010, v110], [v000, v110, v100]] },
    { normal: [0, 0, 1], corners: [[v001, v101, v111], [v001, v111, v011]] },
    { normal: [0, -1, 0], corners: [[v000, v100, v101], [v000, v101, v001]] },
    { normal: [0, 1, 0], corners: [[v010, v011, v111], [v010, v111, v110]] },
    { normal: [-1, 0, 0], corners: [[v000, v001, v011], [v000, v011, v010]] },
    { normal: [1, 0, 0], corners: [[v100, v110, v111], [v100, v111, v101]] },
  ];
  const out: Triangle[] = [];
  for (const face of faces) {
    for (const corners of face.corners) {
      out.push({
        material,
        vertices: corners.map((corner) => ({
          position: [round6(corner[0]), round6(corner[1]), round6(corner[2])],
          normal: [...face.normal] as [number, number, number],
          uv: [0, 0],
          links: [{ bone: 0, weight: 1 }],
        })),
      });
    }
  }
  return out;
}

const QC_BLOCK = z.object({
  path: z.string().describe("Where to write the .qc."),
  modelname: z
    .string()
    .min(1)
    .describe(
      'Target path relative to the game\'s models/ directory, e.g. `props_myaddon/crate.mdl`. ' +
        "A leading `models/` is stripped because studiomdl already adds it.",
    ),
  cdmaterials: z
    .array(z.string())
    .optional()
    .describe("`$cdmaterials`. Defaults to the directories of the brush materials."),
  surfaceprop: z.string().optional().describe("`$surfaceprop`, e.g. `wood`, `metal`."),
  staticprop: z.boolean().default(true).describe("`$staticprop` (a brush prop is normally static)."),
  sequence: z.string().default("idle").describe("`$sequence` name over the bind SMD."),
  fps: z.number().positive().default(30),
  mass: z.number().positive().default(10).describe("`$mass` when a collision model is written."),
  overwrite: z.boolean().default(false),
});

export const brushToModelTool = defineTool({
  name: "brush_to_model",
  description:
    "Converts one or more VMF brush solids into an SMD model source and, optionally, the " +
    "QC. The brush's own planes and faces are the geometry: `checkVmfSolids` rebuilds the " +
    "hull, `orderedLoop` winds each face, and the VMF `uaxis`/`vaxis` become UVs divided by " +
    "`textureSize` (512 by default; per-material overrides via `textureSizes`). The " +
    "origin can stay in world space or move to the brush centre/base. Collision defaults to " +
    "the brush itself (`$concave` when several solids are used); `box` writes an AABB and " +
    "`none` omits it. The optional `qc` block writes `$body`, `$sequence`, `$cdmaterials`, " +
    "`$staticprop` and `$collisionmodel`. This is the Propper++ path without the plugin: " +
    "select a brush in Hammer, read its id with `read_vmf_solids`, and compile the result " +
    "with `run_studiomdl`.",
  realm: "map",
  guarded: true,
  inputSchema: {
    vmf: z.string().describe("Path to the .vmf."),
    solids: z
      .array(z.number().int().nonnegative())
      .min(1)
      .describe("Hammer solid ids to convert. Read them with `read_vmf_solids`."),
    output: z.string().describe("Destination .smd. The suffix is added when missing."),
    origin: z
      .enum(["center", "base", "world"])
      .default("center")
      .describe(
        "Where the model origin goes: the brush's bounding-box centre (default), the " +
          "centre of its base (a floor prop), or the original world position.",
      ),
    scale: z.number().positive().default(1).describe("Uniform model scale after the origin shift."),
    textureSize: z
      .number()
      .positive()
      .default(512)
      .describe("Texture width/height used to normalise UVs. A VMF does not store this."),
    textureSizes: z
      .record(z.number().positive())
      .optional()
      .describe("Per-material texture size, keyed by full material path or basename."),
    flipV: z
      .boolean()
      .default(true)
      .describe("Write SMD V as 1-v, cancelling studiomdl's parse-time inversion."),
    collision: z
      .enum(["brush", "box", "none"])
      .default("brush")
      .describe(
        "Physics source: the brush faces (convex; `$concave` for several solids), an AABB, " +
          "or none. Without a collision model the compiled prop has no .phy.",
      ),
    qc: QC_BLOCK.optional().describe("Also write the QC, including the collision model."),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    vmf: z.string(),
    smd: z.string(),
    written: z.boolean(),
    solids: z.array(z.number()),
    triangles: z.number(),
    vertices: z.number(),
    materials: z.array(
      z.object({
        name: z.string(),
        smd: z.string(),
        triangles: z.number(),
        textureSize: z.number(),
      }),
    ),
    mins: VEC3,
    maxs: VEC3,
    size: VEC3,
    originShift: VEC3,
    collision: z
      .object({
        path: z.string(),
        triangles: z.number(),
        concave: z.boolean(),
        mass: z.number(),
        verified: z.boolean(),
      })
      .nullable(),
    qc: z
      .object({
        path: z.string(),
        written: z.boolean(),
        modelname: z.string(),
        body: z.string(),
        collision: z.string().nullable(),
        diagnostics: z.array(
          z.object({
            severity: z.enum(["error", "warning"]),
            rule: z.string(),
            message: z.string(),
            file: z.string(),
            line: z.number().nullable(),
          }),
        ),
      })
      .optional(),
    warnings: z.array(z.string()),
    diagnostics: z.array(
      z.object({
        severity: z.enum(["error", "warning"]),
        rule: z.string(),
        message: z.string(),
        line: z.number().nullable().optional(),
      }),
    ),
    verified: z.boolean(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const origin = args.origin ?? "center";
    const scale = args.scale ?? 1;
    const textureSizeDefault = args.textureSize ?? 512;
    const flipV = args.flipV ?? true;
    const collisionMode = args.collision ?? "brush";
    const overwrite = args.overwrite ?? false;
    const vmf = resolveInput(args.vmf, ctx.config);
    if (!existsSync(vmf)) throw new Error(`${vmf} does not exist`);
    const raw = readFileSync(vmf);
    if (raw.subarray(0, 4).toString("latin1") === "VBSP") {
      throw new Error(
        `${vmf} is a compiled map (VBSP), not a .vmf text file; use read_bsp_entities ` +
          "(or read_bsp_info) to inspect it",
      );
    }
    const source = raw.toString("utf8");
    const report = checkVmfSolids(vmf, source);
    const byId = new Map<number, SolidCheck>();
    for (const solid of report.solids) if (solid.id !== null) byId.set(solid.id, solid);

    const requested = [...new Set(args.solids)];
    const missing = requested.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const available = [...byId.keys()].slice(0, 20).join(", ");
      throw new Error(
        `solid id(s) ${missing.join(", ")} not found in ${vmf}. Known ids: ${available || "none"}`,
      );
    }

    const selected: SolidCheck[] = [];
    for (const id of requested) {
      const solid = byId.get(id)!;
      const errors = solid.findings.filter((f) => f.severity === "error");
      if (errors.length > 0) {
        throw new Error(
          `solid ${id} is not convertible: ${errors.map((f) => f.message).join("; ")}`,
        );
      }
      if (solid.sides.some((side) => side.hasDisplacement)) {
        throw new Error(
          `solid ${id} has a displacement; its rendered surface is not the face plane. ` +
            "Convert the brush before adding a displacement.",
        );
      }
      selected.push(solid);
    }

    const warnings: string[] = [];
    const diagnostics: Array<{
      severity: "error" | "warning";
      rule: string;
      message: string;
      line?: number | null;
    }> = selected.flatMap((solid) =>
      solid.findings
        // The VMF oracle also emits `info`; every other model diagnostic is error/warning.
        .filter((f) => f.severity !== "info")
        .map((f) => ({
          severity: f.severity as "error" | "warning",
          rule: f.rule,
          message: f.message,
          line: null,
        })),
    );

    const materialCounts = new Map<string, { full: string; dir: string; smd: string; triangles: number }>();
    const triangles: Triangle[] = [];
    const originalPoints: Vec3[] = [];

    for (const solid of selected) {
      for (const side of solid.sides) {
        if (!side.plane || side.vertices.length < 3) continue;
        const material = materialInfo(side.material, "tools/toolsnodraw");
        const textureSize =
          args.textureSizes?.[material.full] ??
          args.textureSizes?.[material.smd] ??
          textureSizeDefault;
        if (!side.uaxis || !side.vaxis) {
          warnings.push(
            `solid ${solid.id}: a face has no uaxis/vaxis; its UVs fall back to the face's ` +
              "base axes",
          );
        }
        const loop = orderedLoop(side.vertices, side.plane.normal);
        if (loop.length < 3) continue;
        const vertices = loop.map((point): TriangleVertex => {
          const uaxis = side.uaxis ?? { axis: [1, 0, 0] as Vec3, offset: 0, scale: 1 };
          const vaxis = side.vaxis ?? { axis: [0, -1, 0] as Vec3, offset: 0, scale: 1 };
          let u = (dot(point, uaxis.axis) / (uaxis.scale || 1) + uaxis.offset) / textureSize;
          let v = (dot(point, vaxis.axis) / (vaxis.scale || 1) + vaxis.offset) / textureSize;
          if (flipV) v = 1 - v;
          originalPoints.push(point);
          return {
            position: [round6(point[0]), round6(point[1]), round6(point[2])],
            normal: [
              round6(side.plane!.normal[0]),
              round6(side.plane!.normal[1]),
              round6(side.plane!.normal[2]),
            ],
            uv: [round6(u), round6(v)],
            links: [{ bone: 0, weight: 1 }],
          };
        });
        for (let index = 1; index < vertices.length - 1; index += 1) {
          triangles.push({
            material: material.smd,
            vertices: [vertices[0]!, vertices[index]!, vertices[index + 1]!],
          });
          const count = materialCounts.get(material.full) ?? {
            full: material.full,
            dir: material.dir,
            smd: material.smd,
            triangles: 0,
          };
          count.triangles += 1;
          materialCounts.set(material.full, count);
        }
      }
    }

    if (triangles.length === 0) {
      throw new Error(`${vmf}: the selected solids produced no triangles`);
    }
    if (materialCounts.size > 1) {
      const byBase = new Map<string, string[]>();
      for (const material of materialCounts.values()) {
        const list = byBase.get(material.smd) ?? [];
        list.push(material.full);
        byBase.set(material.smd, list);
      }
      for (const [base, fulls] of byBase) {
        if (fulls.length > 1) {
          warnings.push(
            `materials ${fulls.join(", ")} share the SMD name ${base}; the engine will ` +
              "resolve the first one in $cdmaterials",
          );
        }
      }
    }

    const axes = [0, 1, 2] as const;
    const mins: Vec3 = axes.map((a) => Math.min(...originalPoints.map((p) => p[a]))) as unknown as Vec3;
    const maxs: Vec3 = axes.map((a) => Math.max(...originalPoints.map((p) => p[a]))) as unknown as Vec3;
    const shift: Vec3 =
      origin === "world"
        ? [0, 0, 0]
        : origin === "base"
          ? [-(mins[0] + maxs[0]) / 2, -(mins[1] + maxs[1]) / 2, -mins[2]]
          : [-(mins[0] + maxs[0]) / 2, -(mins[1] + maxs[1]) / 2, -(mins[2] + maxs[2]) / 2];

    for (const triangle of triangles) {
      for (const vertex of triangle.vertices) {
        const shifted = mul(add(vertex.position as Vec3, shift), scale);
        vertex.position = [round6(shifted[0]), round6(shifted[1]), round6(shifted[2])];
      }
    }

    const outputRequested = resolveInput(args.output, ctx.config);
    const output = outputRequested.toLowerCase().endsWith(".smd")
      ? outputRequested
      : `${outputRequested}.smd`;
    if (existsSync(output) && !overwrite) {
      throw new Error(`${output} already exists; pass overwrite: true to replace it`);
    }
    if (args.qc) {
      const qcPath = resolveInput(args.qc.path, ctx.config);
      if (existsSync(qcPath) && !args.qc.overwrite) {
        throw new Error(`${qcPath} already exists; pass qc.overwrite: true to replace it`);
      }
    }

    const smdResult = (await callSidecar(
      "smd_write",
      {
        path: output,
        nodes: [{ name: "root", parent: null }],
        triangles,
      },
      ctx.config,
      300_000,
    )) as Record<string, unknown>;
    ctx.audit.record({ kind: "file_write", data: { path: output, created: true } });
    diagnostics.push(
      ...((smdResult.diagnostics as Array<{
        severity: "error" | "warning";
        rule: string;
        message: string;
        line?: number | null;
      }>) ?? []),
    );

    const shiftedMins = mul(add(mins, shift), scale);
    const shiftedMaxs = mul(add(maxs, shift), scale);
    const size: Vec3 = [
      shiftedMaxs[0] - shiftedMins[0],
      shiftedMaxs[1] - shiftedMins[1],
      shiftedMaxs[2] - shiftedMins[2],
    ];

    let collisionResult: {
      path: string;
      triangles: number;
      concave: boolean;
      mass: number;
      verified: boolean;
    } | null = null;
    if (collisionMode !== "none") {
      const physicsPath = output.replace(/\.smd$/i, "_phys.smd");
      if (existsSync(physicsPath) && !overwrite) {
        throw new Error(`${physicsPath} already exists; pass overwrite: true to replace it`);
      }
      const physicsTriangles =
        collisionMode === "box"
          ? boxTriangles(shiftedMins, shiftedMaxs, "phys")
          : triangles.map((triangle) => ({
              material: "phys",
              vertices: triangle.vertices.map((vertex) => ({
                ...vertex,
                links: [{ bone: 0, weight: 1 }],
              })),
            }));
      const physicsWritten = (await callSidecar(
        "smd_write",
        {
          path: physicsPath,
          nodes: [{ name: "root", parent: null }],
          triangles: physicsTriangles,
        },
        ctx.config,
        300_000,
      )) as Record<string, unknown>;
      ctx.audit.record({ kind: "file_write", data: { path: physicsPath, created: true } });
      diagnostics.push(
        ...((physicsWritten.diagnostics as Array<{
          severity: "error" | "warning";
          rule: string;
          message: string;
          line?: number | null;
        }>) ?? []),
      );
      collisionResult = {
        path: physicsPath,
        triangles: physicsTriangles.length,
        concave: collisionMode === "brush" && selected.length > 1,
        mass: args.qc?.mass ?? 10,
        verified: Boolean(physicsWritten.verified),
      };
    }

    let qcResult:
      | {
          path: string;
          written: boolean;
          modelname: string;
          body: string;
          collision: string | null;
          diagnostics: Array<{
            severity: "error" | "warning";
            rule: string;
            message: string;
            file: string;
            line: number | null;
          }>;
        }
      | undefined;

    if (args.qc) {
      const qcPath = resolveInput(args.qc.path, ctx.config);
      if (!qcPath.toLowerCase().endsWith(".qc")) {
        throw new Error(`${qcPath} is not a .qc path; studiomdl only reads that extension`);
      }
      const qcDir = dirname(qcPath);
      const smdName = qcRelative(qcDir, output);
      const derived = [...new Set([...materialCounts.values()].map((m) => m.dir).filter(Boolean))];
      const cdmaterials = args.qc.cdmaterials ?? derived;
      if (cdmaterials.length === 0) {
        warnings.push(
          "no $cdmaterials directory could be derived; the materials are expected at the " +
            "root of materials/",
        );
      }
      const physicsName = collisionResult ? qcRelative(qcDir, collisionResult.path) : null;
      const text = buildQc({
        modelname: args.qc.modelname,
        body: [{ name: "Body", smd: smdName }],
        ...(cdmaterials.length > 0 ? { cdmaterials } : {}),
        ...(args.qc.surfaceprop === undefined ? {} : { surfaceprop: args.qc.surfaceprop }),
        staticprop: args.qc.staticprop ?? true,
        sequences: [
          { name: args.qc.sequence ?? "idle", smd: smdName, fps: args.qc.fps ?? 30 },
        ],
        ...(collisionResult && physicsName
          ? {
              collision: {
                smd: physicsName,
                mass: args.qc.mass ?? 10,
                ...(collisionResult.concave ? { concave: true } : {}),
              },
            }
          : {}),
      });
      mkdirSync(dirname(qcPath), { recursive: true });
      const written = writeGuarded(qcPath, text, ctx.config);
      ctx.audit.record({ kind: "file_write", data: { path: written.path, created: true } });
      const parsed = loadQc(written.path);
      qcResult = {
        path: written.path,
        written: written.written,
        modelname: qcModelName(parsed) ?? args.qc.modelname,
        body: smdName,
        collision: physicsName,
        diagnostics: parsed.diagnostics,
      };
    }

    return {
      vmf,
      smd: output,
      written: true,
      solids: selected.map((solid) => solid.id!),
      triangles: triangles.length,
      vertices: triangles.length * 3,
      materials: [...materialCounts.values()]
        .sort((a, b) => b.triangles - a.triangles || (a.full < b.full ? -1 : 1))
        .map((material) => ({
          name: material.full,
          smd: material.smd,
          triangles: material.triangles,
          textureSize:
            args.textureSizes?.[material.full] ??
            args.textureSizes?.[material.smd] ??
            textureSizeDefault,
        })),
      mins: [round6(shiftedMins[0]), round6(shiftedMins[1]), round6(shiftedMins[2])],
      maxs: [round6(shiftedMaxs[0]), round6(shiftedMaxs[1]), round6(shiftedMaxs[2])],
      size: [round6(size[0]), round6(size[1]), round6(size[2])],
      originShift: [round6(shift[0]), round6(shift[1]), round6(shift[2])],
      collision: collisionResult,
      ...(qcResult ? { qc: qcResult } : {}),
      warnings,
      diagnostics,
      verified: Boolean(smdResult.verified) && (collisionResult?.verified ?? true),
      note:
        "The brush's faces are the mesh; UVs are (dot(p, axis)/scale + offset) / textureSize, " +
        "with V flipped for SMD. `origin:'center'` (default) puts the model origin at the " +
        "brush centre; `base` puts it at the centre of the floor. A `$staticprop` compile " +
        "applies studiomdl's own Rz(90°) to the geometry; the engine expects that. " +
        "Displacements are refused, not flattened.",
    };
  },
});

export const brushTools = [brushToModelTool];
