/**
 * `decompile_model`: a compiled model back into a QC and a reference SMD.
 *
 * This is the first half of a decompiler, and it is deliberately explicit about which half.
 * It writes the thing a person needs to start editing again: a reference mesh with the
 * model's real triangles, materials, UVs and bone weights, plus a QC that names the model,
 * its materials, its surface property, its eye/illumination points and its collision. It does
 * not yet write animation SMDs, flex/VTA data, hitboxes, attachments or every bodygroup
 * alternative; the result says so instead of producing a quiet, incomplete model.
 *
 * Geometry comes from `parseModelGeometry`, so the VVD fixup table and the selected VTX
 * layout are already applied. Vertices are written in model space, which is what SMD expects;
 * the skeleton is the bind pose from the MDL bone records. Collision comes from the `.phy`
 * when one is installed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";
import { openGameVpk } from "../../../assets/typescript/game/vpkcontent.js";
import { parseModelGeometry } from "../formats/mdlmesh.js";
import type { ModelGeometry, ModelVertex, Vec3 } from "../formats/mdlmesh.js";
import { modelSiblings } from "../../../assets/typescript/game/models.js";
import { quaternionToEuler, readMdlBones, readModelHeaderInfo } from "../formats/mdlbones.js";
import type { ModelBone } from "../formats/mdlbones.js";
import { readPhy, readPhyGeometry } from "../formats/phy.js";

const STATIC_PROP = 1 << 4;
const FORCE_OPAQUE = 1 << 2;
const TRANSLUCENT_TWOPASS = 1 << 3;

function normalizeModelPath(model: string): string {
  let path = model.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path.toLowerCase().endsWith(".mdl")) path += ".mdl";
  if (!path.toLowerCase().startsWith("models/")) path = `models/${path}`;
  return path;
}

function safeBase(path: string): string {
  return (
    basename(path, ".mdl")
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "model"
  );
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "0.000000";
}

function chooseBone(vertex: ModelVertex, boneCount: number): number {
  if (vertex.bones) {
    for (let i = 0; i < (vertex.boneCount ?? 0); i += 1) {
      const bone = vertex.bones[i];
      if (bone !== undefined && bone >= 0 && bone < boneCount) return bone;
    }
  }
  return 0;
}

function boneLinks(vertex: ModelVertex, boneCount: number): Array<[number, number]> {
  const links: Array<[number, number]> = [];
  const count = Math.min(3, vertex.boneCount ?? 0);
  if (vertex.bones && vertex.weights) {
    for (let i = 0; i < count; i += 1) {
      const bone = vertex.bones[i];
      const weight = vertex.weights[i];
      if (bone === undefined || weight === undefined) continue;
      if (bone < 0 || bone >= boneCount || !(weight > 0)) continue;
      links.push([bone, weight]);
    }
  }
  if (links.length === 0) links.push([0, 1]);
  return links;
}

function writeVertexLine(vertex: ModelVertex, boneCount: number, staticProp: boolean): string {
  const links = boneLinks(vertex, boneCount);
  const parent = chooseBone(vertex, boneCount);
  const p = vertex.position;
  const n = vertex.normal;
  const [u, v] = vertex.uv;
  // A static prop's VVD is stored with the X/Y axes swapped relative to SMD; Crowbar calls
  // this the static-prop reference-mesh rotation. Applying it here is what makes the
  // recompiled model's bounds match the source instead of coming out 90 degrees turned.
  const position: Vec3 = staticProp ? [p[1], -p[0], p[2]] : p;
  const normal: Vec3 = staticProp ? [n[1], -n[0], n[2]] : n;
  return [
    "  ",
    parent,
    " ",
    fmt(position[0]),
    " ",
    fmt(position[1]),
    " ",
    fmt(position[2]),
    " ",
    fmt(normal[0]),
    " ",
    fmt(normal[1]),
    " ",
    fmt(normal[2]),
    " ",
    fmt(u),
    " ",
    fmt(1 - v),
    " ",
    links.length,
    ...links.flatMap(([bone, weight]) => [" ", bone, " ", fmt(weight)]),
  ].join("");
}

function referenceSmd(geometry: ModelGeometry, bones: ModelBone[], staticProp: boolean): string {
  const boneCount = Math.max(1, bones.length);
  const lines: string[] = ["version 1", "nodes"];
  if (bones.length === 0) {
    lines.push('0 "static_prop" -1');
  } else {
    for (const bone of bones) {
      lines.push(`${bone.index} "${bone.name.replace(/"/g, "")}" ${bone.parent}`);
    }
  }
  lines.push("end", "skeleton", "time 0");
  if (bones.length === 0) {
    lines.push("0 0.000000 0.000000 0.000000 0.000000 0.000000 0.000000");
  } else {
    for (const bone of bones) {
      const [rx, ry, rz] = quaternionToEuler(bone.rotation);
      lines.push(
        `${bone.index} ${fmt(bone.position[0])} ${fmt(bone.position[1])} ${fmt(bone.position[2])} ` +
          `${fmt(rx)} ${fmt(ry)} ${fmt(rz)}`,
      );
    }
  }
  lines.push("end", "triangles");

  for (const mesh of geometry.meshes) {
    const material = geometry.materials[mesh.materialIndex] ?? "material";
    const smdMaterial = material.split("/").pop() ?? material;
    for (let t = 0; t + 2 < mesh.triangles.length; t += 3) {
      // A material line before each triangle is what the stock SMD reader accepts; a single
      // material line followed by many triangles is legal in the format but this compiler
      // treats the following lines as new materials.
      lines.push(smdMaterial);
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = mesh.vertices[mesh.triangles[t + corner]!]!;
        lines.push(writeVertexLine(vertex, boneCount, staticProp));
      }
    }
  }
  lines.push("end");
  return `${lines.join("\n")}\n`;
}

function collisionSmd(phyBytes: Buffer, staticProp: boolean): { text: string; triangles: number } | null {
  const geometry = readPhyGeometry(phyBytes);
  if (geometry.solids.length === 0) return null;
  const lines: string[] = [
    "version 1",
    "nodes",
    '0 "phys" -1',
    "end",
    "skeleton",
    "time 0",
    "0 0.000000 0.000000 0.000000 0.000000 0.000000 0.000000",
    "end",
    "triangles",
  ];
  let triangles = 0;
  for (const solid of geometry.solids) {
    for (const [a, b, c] of solid.triangles) {
      lines.push("phys");
      for (const index of [a, b, c]) {
        const vertex = solid.vertices[index];
        if (!vertex) continue;
        const position: Vec3 = staticProp ? [vertex[1], -vertex[0], vertex[2]] : vertex;
        lines.push(
          `  0 ${fmt(position[0])} ${fmt(position[1])} ${fmt(position[2])} ` +
            `0.000000 0.000000 1.000000 0.000000 0.000000 1 0 1.000000`,
        );
      }
      triangles += 1;
    }
  }
  lines.push("end");
  return { text: `${lines.join("\n")}\n`, triangles };
}

function materialDirs(geometry: ModelGeometry): string[] {
  const dirs = new Set<string>();
  for (const material of geometry.materials) {
    const cut = material.lastIndexOf("/");
    if (cut > 0) dirs.add(material.slice(0, cut + 1));
  }
  return [...dirs].sort();
}

function qcText(
  geometry: ModelGeometry,
  header: ReturnType<typeof readModelHeaderInfo>,
  base: string,
  targetModelName: string,
  collision: { smdName: string; mass: number; concave: boolean } | null,
): string {
  const modelname = targetModelName
    .replace(/\\/g, "/")
    .replace(/^models\//i, "")
    .replace(/\.mdl$/i, "");
  const lines: string[] = [
    `// Decompiled by L4D2-HSMCP: LOD 0 reference mesh, model 0 of each body part.`,
    `// Animations, flexes, hitboxes, attachments and skin families are not extracted yet.`,
    "",
    `$modelname "${modelname}.mdl"`,
    `$body "Body" "${base}_ref.smd"`,
  ];
  for (const dir of materialDirs(geometry)) lines.push(`$cdmaterials "${dir}"`);
  if (header?.surfaceProp) lines.push(`$surfaceprop "${header.surfaceProp}"`);
  if ((header?.flags ?? 0) & STATIC_PROP) lines.push("$staticprop");
  if ((header?.flags ?? 0) & TRANSLUCENT_TWOPASS) lines.push("$mostlyopaque");
  else if ((header?.flags ?? 0) & FORCE_OPAQUE) lines.push("$opaque");

  // studiomdl refuses a model with no sequences. The reference SMD is a single-frame bind
  // pose, so a one-frame idle is honest: it compiles, and it is not pretending to be the
  // original animation set, which this first decompiler does not extract.
  lines.push(`$sequence "idle" "${base}_ref.smd" fps 1`);

  const illum = header?.illuminationPosition;
  if (illum && illum.some((value) => Math.abs(value) > 1e-6)) {
    lines.push(`$illumposition ${fmt(illum[1])} ${fmt(-illum[0])} ${fmt(illum[2])}`);
  }
  const eye = header?.eyePosition;
  if (eye && eye.some((value) => Math.abs(value) > 1e-6)) {
    lines.push(`$eyeposition ${fmt(eye[1])} ${fmt(-eye[0])} ${fmt(eye[2])}`);
  }

  if (collision) {
    lines.push("", `$collisionmodel "${collision.smdName}"`, "{", `\t$mass ${fmt(collision.mass)}`);
    if (collision.concave) lines.push("\t$concave");
    lines.push("}");
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function keyValueNumber(text: string | null, key: string, fallback: number): number {
  if (!text) return fallback;
  const match = new RegExp(`"${key}"\\s+"([^"]*)"`, "i").exec(text);
  const value = match ? Number.parseFloat(match[1]!) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

export const decompileModelTool = defineTool({
  name: "decompile_model",
  description:
    "Decompiles a compiled model into a QC and a reference SMD, plus a collision SMD when a " +
    "`.phy` is installed. The reference mesh has the model's real triangles, materials, UVs, " +
    "bone weights and bind-pose skeleton; the QC has `$modelname`, `$body`, `$cdmaterials`, " +
    "`$surfaceprop`, `$staticprop`, eye/illumination points and `$collisionmodel` (with " +
    "`$concave` when the collision has more than one convex piece). Animations, flexes, " +
    "hitboxes, attachments, bodygroup alternatives and skin families are not extracted yet, " +
    "and the result lists those gaps. Writes into `outDir`; refuses existing files unless " +
    "`overwrite` is set. Takes an engine model path or a local `.mdl`.",
  realm: "map",
  guarded: true,
  inputSchema: {
    model: z
      .string()
      .optional()
      .describe("Engine model path; the models/ prefix and .mdl suffix are added if missing."),
    path: z
      .string()
      .optional()
      .describe("Local .mdl path, absolute or relative to the repo root."),
    outDir: z.string().min(1).describe("Directory for the QC, SMDs and collision SMD."),
    modelname: z
      .string()
      .optional()
      .describe(
        "Target `$modelname`, relative to the game's models/ directory. Defaults to the " +
          "source name with `_decompiled` appended, so a direct recompile cannot overwrite " +
          "the model it came from.",
      ),
    collision: z
      .boolean()
      .default(true)
      .describe("Write a collision SMD and `$collisionmodel` when a .phy is installed."),
    overwrite: z.boolean().default(false),
    game: GAME,
    confirm: CONFIRM,
  },
  outputSchema: {
    game: GAME_BLOCK,
    model: z.string(),
    modelname: z.string(),
    outDir: z.string(),
    qc: z.string(),
    smd: z.string(),
    collisionSmd: z.string().nullable(),
    files: z.array(z.object({ path: z.string(), bytes: z.number() })),
    triangleCount: z.number(),
    collisionTriangles: z.number(),
    boneCount: z.number(),
    warnings: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    let mdlBytes: Buffer | null = null;
    let vvdBytes: Buffer | null = null;
    let vtxBytes: Buffer | null = null;
    let phyBytes: Buffer | null = null;
    let modelPath: string;

    if (args.path) {
      const input = resolveInput(args.path, ctx.config);
      if (extname(input).toLowerCase() !== ".mdl") throw new Error("`path` must be a .mdl");
      modelPath = input;
      mdlBytes = readFileSync(input);
      const siblings = modelSiblings(input);
      if (existsSync(siblings.vvd)) vvdBytes = readFileSync(siblings.vvd);
      for (const candidate of siblings.vtx) {
        if (existsSync(candidate)) {
          vtxBytes = readFileSync(candidate);
          break;
        }
      }
      const phy = input.replace(/\.mdl$/i, ".phy");
      if (existsSync(phy)) phyBytes = readFileSync(phy);
    } else if (args.model) {
      if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
      modelPath = normalizeModelPath(args.model);
      const vpk = openGameVpk(game.gameDir);
      const loose = join(game.gameDir, modelPath);
      mdlBytes = existsSync(loose) ? readFileSync(loose) : vpk?.read(modelPath) ?? null;
      const siblings = modelSiblings(modelPath);
      vvdBytes = vpk?.read(siblings.vvd) ?? null;
      for (const candidate of siblings.vtx) {
        const bytes = vpk?.read(candidate);
        if (bytes) {
          vtxBytes = bytes;
          break;
        }
      }
      phyBytes = vpk?.read(modelPath.replace(/\.mdl$/i, ".phy")) ?? null;
    } else {
      throw new Error("give `model` (engine path) or `path` (local .mdl)");
    }

    if (!mdlBytes || !vvdBytes || !vtxBytes) {
      throw new Error(`the .mdl/.vvd/.vtx trio for ${modelPath} is not installed`);
    }
    const geometry = parseModelGeometry(mdlBytes, vvdBytes, vtxBytes);
    if (!geometry) throw new Error(`could not parse ${modelPath} as a model`);
    const header = readModelHeaderInfo(mdlBytes);
    const bones = readMdlBones(mdlBytes);
    const base = safeBase(modelPath);
    const sourceModelName = (header?.name || geometry.name).replace(/\\/g, "/");
    const targetModelName =
      args.modelname ??
      `${sourceModelName.replace(/\.mdl$/i, "")}_decompiled.mdl`;
    const writeCollision = args.collision !== false;
    const outDir = resolveInput(args.outDir, ctx.config);
    assertWritable(outDir, ctx.config);
    mkdirSync(outDir, { recursive: true });

    const qcPath = join(outDir, `${base}.qc`);
    const smdPath = join(outDir, `${base}_ref.smd`);
    const collisionPath = join(outDir, `${base}_phys.smd`);
    const targets = [qcPath, smdPath, ...(writeCollision && phyBytes ? [collisionPath] : [])];
    for (const target of targets) {
      assertWritable(target, ctx.config);
      if (existsSync(target) && !args.overwrite) {
        throw new Error(`${target} already exists; pass overwrite: true to replace it`);
      }
    }

    const warnings: string[] = [];
    const staticProp = ((header?.flags ?? 0) & STATIC_PROP) !== 0;
    const smd = referenceSmd(geometry, bones, staticProp);
    writeFileSync(smdPath, smd, "latin1");

    let collision: { smdName: string; mass: number; concave: boolean } | null = null;
    let collisionTriangles = 0;
    if (writeCollision && phyBytes) {
      const smdCollision = collisionSmd(phyBytes, staticProp);
      if (smdCollision) {
        writeFileSync(collisionPath, smdCollision.text, "latin1");
        collisionTriangles = smdCollision.triangles;
        const report = readPhy(phyBytes);
        collision = {
          smdName: `${base}_phys.smd`,
          mass: keyValueNumber(report.collisionText, "mass", 10),
          concave: report.maxConvexPieces > 1,
        };
      } else {
        warnings.push("The .phy had no readable collision geometry; no $collisionmodel was written.");
      }
    } else if (writeCollision) {
      warnings.push("No .phy is installed; no $collisionmodel was written. The prop is non-solid unless its solid key is 2.");
    }

    const qc = qcText(geometry, header, base, targetModelName, collision);
    writeFileSync(qcPath, qc, "latin1");
    warnings.push(
      "Reference mesh is LOD 0 and model 0 of each body part; LOD replacements and bodygroup alternatives are not extracted.",
    );
    warnings.push(
      "Animations, flexes, hitboxes, attachments and skin families are not extracted; the QC omits them rather than inventing them. A one-frame `$sequence \"idle\"` is written so the reference mesh can compile.",
    );
    if (geometry.materials.length === 0) warnings.push("The model header names no materials.");

    return {
      game: gameBlock(game, from),
      model: modelPath,
      modelname: targetModelName,
      outDir,
      qc: qcPath,
      smd: smdPath,
      collisionSmd: collision ? collisionPath : null,
      files: [
        { path: qcPath, bytes: Buffer.byteLength(qc) },
        { path: smdPath, bytes: Buffer.byteLength(smd) },
        ...(collision
          ? [{ path: collisionPath, bytes: existsSync(collisionPath) ? readFileSync(collisionPath).length : 0 }]
          : []),
      ],
      triangleCount: geometry.meshes.reduce((sum, mesh) => sum + mesh.triangles.length / 3, 0),
      collisionTriangles,
      boneCount: bones.length,
      warnings,
    };
  },
});

export const decompileModelTools = [decompileModelTool];
