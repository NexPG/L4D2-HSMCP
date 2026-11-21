/**
 * VTA (vertex animation) read and write.
 *
 * A VTA is the QC input that carries flex targets: a `nodes` block, a `skeleton` block that
 * lists the frames, and a `vertexanimation` block where `time 0` is the basis shape and each
 * later `time` is one flex. The basis lists every fixed LOD-0 vertex; a flex frame lists the
 * **deformed** position and normal (`base + delta`), not the delta, because studiomdl
 * subtracts the bind mesh itself.
 *
 * The writer is deliberately the same shape as `buildVta` in `mdlvta.ts`: the decompiler
 * uses that one for geometry it already has, and this one for a hand-authored file.
 */
import type { Vec3 } from "./mdlmesh.js";

export interface VtaNode {
  index: number;
  name: string;
  parent: number;
}

export interface VtaVertex {
  index: number;
  position: Vec3;
  normal: Vec3;
}

export interface VtaFrame {
  frame: number;
  /** The comment after `time N #`, or the frame number when absent. */
  name: string;
  vertices: VtaVertex[];
}

export interface VtaFile {
  nodes: VtaNode[];
  /** Frame numbers declared in `skeleton`. The vertex data may list a different count. */
  skeletonFrames: number[];
  /** `time 0`, the basis shape. */
  basis: VtaFrame;
  /** `time 1..`, one per flex. */
  frames: VtaFrame[];
  warnings: string[];
}

const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const VERTEX = new RegExp(
  String.raw`^\s*(\d+)\s+(${NUMBER})\s+(${NUMBER})\s+(${NUMBER})\s+(${NUMBER})\s+(${NUMBER})\s+(${NUMBER})`,
);
const TIME = /^\s*time\s+(\d+)\s*(?:#\s*(.*))?$/i;
const NODE = /^\s*(\d+)\s+"([^"]*)"\s+(-?\d+)/;

export class VtaFormatError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = "VtaFormatError";
  }
}

/** Parses a VTA. A frame with no vertices is kept: an empty flex is data, not a typo. */
export function parseVta(text: string): VtaFile {
  const nodes: VtaNode[] = [];
  const skeletonFrames: number[] = [];
  const frames: VtaFrame[] = [];
  const warnings: string[] = [];
  let section = "";
  let current: VtaFrame | null = null;
  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/);

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.replace(/#.*$/, "").trimEnd();
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//")) return;
    if (/^version\b/i.test(trimmed)) return;
    if (/^nodes$/i.test(trimmed)) {
      section = "nodes";
      return;
    }
    if (/^skeleton$/i.test(trimmed)) {
      section = "skeleton";
      return;
    }
    if (/^vertexanimation$/i.test(trimmed)) {
      section = "vertices";
      return;
    }
    if (/^end$/i.test(trimmed)) {
      if (section === "vertices" && current) {
        frames.push(current);
        current = null;
      }
      section = "";
      return;
    }
    if (section === "nodes") {
      const match = NODE.exec(line);
      if (!match) throw new VtaFormatError(`cannot read node line: ${raw.trim()}`, lineNumber);
      nodes.push({
        index: Number(match[1]),
        name: match[2]!,
        parent: Number(match[3]),
      });
      return;
    }
    if (section === "skeleton") {
      const match = TIME.exec(line);
      if (match) skeletonFrames.push(Number(match[1]));
      else warnings.push(`skeleton line ${lineNumber} is not a time line: ${raw.trim()}`);
      return;
    }
    if (section === "vertices") {
      // The frame name lives after `#`, so this one is read from the raw line.
      const time = TIME.exec(raw.trim());
      if (time) {
        if (current) frames.push(current);
        current = {
          frame: Number(time[1]),
          name: (time[2] ?? String(time[1])).trim(),
          vertices: [],
        };
        return;
      }
      const match = VERTEX.exec(line);
      if (!match) {
        throw new VtaFormatError(`cannot read vertex line: ${raw.trim()}`, lineNumber);
      }
      if (!current) {
        throw new VtaFormatError("a vertex line appears before any `time` line", lineNumber);
      }
      current.vertices.push({
        index: Number(match[1]),
        position: [Number(match[2]), Number(match[3]), Number(match[4])],
        normal: [Number(match[5]), Number(match[6]), Number(match[7])],
      });
    }
  });
  if (current) frames.push(current);

  const basis = frames.find((frame) => frame.frame === 0) ?? {
    frame: 0,
    name: "basis shape key",
    vertices: [],
  };
  const animationFrames = frames
    .filter((frame) => frame.frame !== 0)
    .sort((left, right) => left.frame - right.frame);
  if (basis.vertices.length === 0) {
    warnings.push("the basis (`time 0`) has no vertices; studiomdl cannot build the mesh from it");
  }
  const indices = new Set<number>();
  for (const vertex of basis.vertices) {
    if (indices.has(vertex.index)) {
      warnings.push(`vertex ${vertex.index} appears more than once in the basis; the last wins`);
    }
    indices.add(vertex.index);
  }
  return { nodes, skeletonFrames, basis, frames: animationFrames, warnings };
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "0.000000";
}

/** Writes a VTA. `basis` must already be in the SMD frame (static-prop swap applied if any). */
export function buildVtaText(
  basis: VtaVertex[],
  frames: Array<{ name: string; vertices: VtaVertex[] }>,
  nodes: VtaNode[] = [{ index: 0, name: "static_prop", parent: -1 }],
): string {
  const lines: string[] = ["version 1", "nodes"];
  for (const node of nodes) {
    lines.push(`${node.index} "${node.name.replace(/"/g, "")}" ${node.parent}`);
  }
  lines.push("end", "skeleton");
  for (let frame = 0; frame <= frames.length; frame += 1) {
    lines.push(frame === 0 ? "time 0 # basis shape key" : `time ${frame} # ${frames[frame - 1]!.name}`);
  }
  lines.push("end", "vertexanimation", "time 0 # basis shape key");
  for (const vertex of basis) {
    lines.push(
      `    ${vertex.index} ${fmt(vertex.position[0])} ${fmt(vertex.position[1])} ` +
        `${fmt(vertex.position[2])} ${fmt(vertex.normal[0])} ${fmt(vertex.normal[1])} ` +
        `${fmt(vertex.normal[2])}`,
    );
  }
  for (const [offset, frame] of frames.entries()) {
    lines.push(`time ${offset + 1} # ${frame.name.replace(/\r?\n/g, " ")}`);
    for (const vertex of frame.vertices) {
      lines.push(
        `    ${vertex.index} ${fmt(vertex.position[0])} ${fmt(vertex.position[1])} ` +
          `${fmt(vertex.position[2])} ${fmt(vertex.normal[0])} ${fmt(vertex.normal[1])} ` +
          `${fmt(vertex.normal[2])}`,
      );
    }
  }
  lines.push("end");
  return `${lines.join("\n")}\n`;
}
