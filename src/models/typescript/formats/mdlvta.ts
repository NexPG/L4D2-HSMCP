/**
 * Decompiled flex deltas -> a VTA (vertex animation) file for studiomdl.
 *
 * A VTA is the compiler input that carries morph targets next to an SMD reference mesh.
 * Two details make it work and both are easy to get wrong:
 *
 * - The basis frame (`time 0`) lists **every** fixed LOD-0 vertex, in order. The compiler
 *   welds the SMD's triangle corners into its own vertex array, and the VTA index addresses
 *   that array; listing the whole fixed list keeps the two in step.
 * - A flex frame lists the *deformed* position and normal (basis + delta), not the delta.
 *   StudioMDL compares the frame with the bind mesh and writes the difference.
 *
 * The delta fields in the compiled MDL are float16 (see `mdlflex.ts`); writing the decoded
 * floats back as `base + delta` round-trips through that encoding.
 */
import type { ModelBone } from "./mdlbones.js";
import type { ModelGeometry, ModelMesh, Vec3 } from "./mdlmesh.js";

export interface VtaFrame {
  /** Descriptor name written in `flex "<name>" frame <frame>`. */
  name: string;
  /** VTA frame number, starting at 1; frame 0 is the basis. */
  frame: number;
  /** How many fixed vertices this frame moves. */
  vertices: number;
}

export interface VtaResult {
  text: string;
  frames: VtaFrame[];
  warnings: string[];
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "0.000000";
}

/** The same static-prop rotation the reference SMD uses, so both inputs agree. */
function orient(point: Vec3, staticProp: boolean): Vec3 {
  return staticProp ? [point[1], -point[0], point[2]] : point;
}

/**
 * Builds the VTA for the flexes of one bodygroup alternative. `meshes` are that
 * alternative's LOD-0 meshes; their flex records already carry absolute vertex indices.
 */
export function buildVta(
  geometry: ModelGeometry,
  meshes: ModelMesh[],
  bones: ModelBone[],
  staticProp: boolean,
): VtaResult {
  const warnings: string[] = [];
  const descriptors = new Map<number, string>();
  const deltas = new Map<number, Map<number, { delta: Vec3; normalDelta: Vec3 }>>();
  let skipped = 0;

  for (const mesh of meshes) {
    for (const flex of mesh.flexes ?? []) {
      const name = geometry.flex.descriptors[flex.flexDesc] ?? `flex_${flex.flexDesc}`;
      descriptors.set(flex.flexDesc, name);
      if (flex.flexPair !== 0 && !warnings.some((warning) => warning.startsWith("flexpair"))) {
        warnings.push(
          `flexpair: descriptor "${name}" is paired with another descriptor; the pair is ` +
            "written as two independent frames",
        );
      }
      if (flex.vertAnimType !== 0) {
        warnings.push(
          `"${name}" is a wrinkle flex; a VTA carries position and normal deltas only, so ` +
            "the wrinkle channel is not written",
        );
      }
      const map: Map<number, { delta: Vec3; normalDelta: Vec3 }> =
        deltas.get(flex.flexDesc) ?? new Map();
      deltas.set(flex.flexDesc, map);
      for (const vertex of flex.vertices) {
        if (vertex.index < 0 || vertex.index >= geometry.lod0Vertices.length) {
          skipped += 1;
          continue;
        }
        const previous = map.get(vertex.index);
        if (
          previous &&
          (previous.delta.some((value, axis) => value !== vertex.delta[axis]) ||
            previous.normalDelta.some((value, axis) => value !== vertex.normalDelta[axis]))
        ) {
          warnings.push(
            `"${name}": vertex ${vertex.index} is named by two flex records with different ` +
              "deltas; the first was kept",
          );
          continue;
        }
        map.set(vertex.index, { delta: vertex.delta, normalDelta: vertex.normalDelta });
      }
    }
  }
  if (skipped > 0) {
    warnings.push(`${skipped} flex deltas named a vertex outside the LOD-0 list and were skipped`);
  }

  const ordered = [...descriptors.entries()]
    .sort(([left], [right]) => left - right)
    .map(([descriptor, name]) => ({ descriptor, name, vertices: deltas.get(descriptor)! }))
    .filter((entry) => entry.vertices.size > 0);

  const lines: string[] = ["version 1", "nodes"];
  if (bones.length === 0) {
    lines.push('0 "static_prop" -1');
  } else {
    for (const bone of bones) {
      lines.push(`${bone.index} "${bone.name.replace(/"/g, "")}" ${bone.parent}`);
    }
  }
  lines.push("end", "skeleton");
  for (let frame = 0; frame <= ordered.length; frame += 1) {
    lines.push(
      frame === 0
        ? "time 0 # basis shape key"
        : `time ${frame} # ${ordered[frame - 1]!.name}`,
    );
  }
  lines.push("end", "vertexanimation", "time 0 # basis shape key");
  for (const [index, vertex] of geometry.lod0Vertices.entries()) {
    const position = orient(vertex.position, staticProp);
    const normal = orient(vertex.normal, staticProp);
    lines.push(
      `    ${index} ${fmt(position[0])} ${fmt(position[1])} ${fmt(position[2])} ` +
        `${fmt(normal[0])} ${fmt(normal[1])} ${fmt(normal[2])}`,
    );
  }

  const frames: VtaFrame[] = [];
  for (const [offset, entry] of ordered.entries()) {
    const frame = offset + 1;
    lines.push(`time ${frame} # ${entry.name}`);
    for (const index of [...entry.vertices.keys()].sort((left, right) => left - right)) {
      const base = geometry.lod0Vertices[index]!;
      const delta = entry.vertices.get(index)!;
      const position = orient(
        [
          base.position[0] + delta.delta[0],
          base.position[1] + delta.delta[1],
          base.position[2] + delta.delta[2],
        ],
        staticProp,
      );
      const normal = orient(
        [
          base.normal[0] + delta.normalDelta[0],
          base.normal[1] + delta.normalDelta[1],
          base.normal[2] + delta.normalDelta[2],
        ],
        staticProp,
      );
      lines.push(
        `    ${index} ${fmt(position[0])} ${fmt(position[1])} ${fmt(position[2])} ` +
          `${fmt(normal[0])} ${fmt(normal[1])} ${fmt(normal[2])}`,
      );
    }
    frames.push({ name: entry.name, frame, vertices: entry.vertices.size });
  }
  lines.push("end");

  return { text: `${lines.join("\n")}\n`, frames, warnings };
}
