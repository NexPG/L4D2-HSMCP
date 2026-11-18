/**
 * `info_overlay` creation: a decal projected onto an existing brush face.
 *
 * The VMF format was read from Valve's own `sdk_content/mapsrc/styleguide_urban.vmf`:
 * an overlay is a point entity whose `sides` key is the id of the face it sits on, with a
 * basis (origin, normal, U, V) and four corners in that basis. The plane points in a VMF are
 * ordered clockwise seen from the front, so the cross product points *into* the brush; the
 * overlay normal is its negation.
 */
import { parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock, KvPair } from "../../../formats/typescript/kv/parse.js";

export type Vec3 = [number, number, number];

export interface OverlaySpec {
  sideId: number;
  material: string;
  /** A point on the face, in world coordinates. */
  origin: Vec3;
  width: number;
  height: number;
}

export interface OverlayResult {
  keyvalues: Record<string, string>;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  /** Classname of the entity that owns the brush (worldspawn for world geometry). */
  sideClass: string;
}

function pairs(block: KvBlock): KvPair[] {
  return block.entries.filter((e): e is KvPair => e.kind === "pair");
}

function value(block: KvBlock, key: string): string | null {
  const found = pairs(block).find((p) => p.key.toLowerCase() === key.toLowerCase());
  return found?.value ?? null;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) throw new Error("zero-length vector");
  return [v[0] / len, v[1] / len, v[2] / len].map((n) => (n === 0 ? 0 : n)) as Vec3;
}

function round(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
}

function vec(v: Vec3): string {
  return `${round(v[0])} ${round(v[1])} ${round(v[2])}`;
}

function parsePlane(text: string): [Vec3, Vec3, Vec3] {
  const points = [...text.matchAll(/\(([^)]+)\)/g)].map((m) =>
    m[1]!.trim().split(/\s+/).map(Number),
  );
  if (points.length !== 3 || points.some((p) => p.length !== 3 || p.some(Number.isNaN))) {
    throw new Error(`cannot read a plane from ${JSON.stringify(text)}`);
  }
  return points as [Vec3, Vec3, Vec3];
}

interface FoundSide {
  side: KvBlock;
  classname: string;
}

function findSide(nodes: KvBlock[], sideId: number): FoundSide {
  for (const node of nodes) {
    if (node.name === "world") {
      for (const entry of node.entries) {
        if (entry.kind !== "block" || entry.name !== "solid") continue;
        for (const side of entry.entries) {
          if (side.kind !== "block" || side.name !== "side") continue;
          if (Number(value(side, "id")) === sideId) return { side, classname: "worldspawn" };
        }
      }
    }
    if (node.name === "entity") {
      const classname = value(node, "classname") ?? "entity";
      for (const entry of node.entries) {
        if (entry.kind !== "block" || entry.name !== "solid") continue;
        for (const side of entry.entries) {
          if (side.kind !== "block" || side.name !== "side") continue;
          if (Number(value(side, "id")) === sideId) return { side, classname };
        }
      }
    }
  }
  throw new Error(`no side with id ${sideId} in this .vmf`);
}

/** Builds the keyvalues of an `info_overlay` on `spec.sideId`. */
export function buildOverlay(vmfText: string, spec: OverlaySpec): OverlayResult {
  if (!spec.material.trim()) throw new Error("an overlay needs a material");
  if (spec.width <= 0 || spec.height <= 0) throw new Error("overlay width and height must be positive");

  const roots = parse(vmfText).filter((n): n is KvBlock => n.kind === "block");
  const { side, classname } = findSide(roots, spec.sideId);
  const planeText = value(side, "plane");
  if (!planeText) throw new Error(`side ${spec.sideId} has no plane`);

  const [p1, p2, p3] = parsePlane(planeText);
  // The plane points are clockwise seen from the front; the visible normal is the negation.
  const normal = normalize(cross(sub(p2, p1), sub(p3, p1))).map((n) =>
    n === 0 ? 0 : -n,
  ) as Vec3;

  const distance = Math.abs(dot(sub(spec.origin, p1), normal));
  if (distance > 1) {
    throw new Error(
      `origin ${vec(spec.origin)} is ${round(distance)} units off the plane of side ` +
        `${spec.sideId}; an overlay must sit on its face`,
    );
  }

  const reference: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(reference, normal));
  const v = normalize(cross(normal, u));

  const hw = spec.width / 2;
  const hh = spec.height / 2;
  const keyvalues: Record<string, string> = {
    classname: "info_overlay",
    angles: "0 0 0",
    BasisNormal: vec(normal),
    BasisOrigin: vec(spec.origin),
    BasisU: vec(u),
    BasisV: vec(v),
    StartU: "0",
    EndU: "1",
    StartV: "0",
    EndV: "1",
    material: spec.material,
    sides: String(spec.sideId),
    uv0: `${round(-hw)} ${round(-hh)} 0`,
    uv1: `${round(-hw)} ${round(hh)} 0`,
    uv2: `${round(hw)} ${round(hh)} 0`,
    uv3: `${round(hw)} ${round(-hh)} 0`,
    origin: vec(spec.origin),
    fademindist: "-1",
  };

  return { keyvalues, normal, u, v, sideClass: classname };
}
