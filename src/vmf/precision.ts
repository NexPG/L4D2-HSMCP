/**
 * Hammer++'s `vertices_plus`: exact face windings stored beside the ordinary `plane` line.
 *
 * The compilers and vanilla Hammer read the plane; Hammer++ reads the vertex block first.
 * That makes a stale block worse than a missing one: after a brush is moved, an old
 * `vertices_plus` would draw the brush where it used to be. These helpers keep the two
 * views in step for moves and drops the block where a face is cut and can no longer state
 * the same loop.
 */
import type { Vec3 } from "./solid.js";

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : Number(n.toFixed(6)).toString();
const fmtVec = (v: Vec3): string => `${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`;

/** Applies a point transform to every `"v"` pair in a `vertices_plus` block. */
export function mapVerticesPlus(text: string, move: (v: Vec3) => Vec3): string {
  return text.replace(/("v")(\s+)"([^"]+)"/g, (whole, key: string, space: string, value: string) => {
    const n = value.trim().split(/\s+/).map(Number);
    if (n.length !== 3 || n.some((v) => !Number.isFinite(v))) return whole;
    return `${key}${space}"${fmtVec(move([n[0]!, n[1]!, n[2]!]))}"`;
  });
}

/** Removes a `vertices_plus` block, leaving the plane as the only description of the face. */
export function stripVerticesPlus(text: string): string {
  return text.replace(/(^|\n)[ \t]*vertices_plus\s*\{[^}]*\}/g, "$1");
}
