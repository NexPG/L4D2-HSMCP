/**
 * Placing a rotating door in an opening.
 *
 * A Source door model's origin is its **hinge**, not the centre of the leaf. For
 * `checkpoint_door_02`, the hull runs from -2.6 to +55.7 on the model's local Y: the origin
 * sits on one jamb and the leaf extends 58.3 units one way. Putting that origin in the
 * middle of a 64-unit opening leaves half the doorway open and pushes the other half through
 * the wall. This function turns an opening and a model's hull into the origin the entity
 * needs.
 */
import type { Vec3 } from "./solid.js";

export interface DoorBounds {
  /** The model's hull relative to its origin, from `read_model_info`. */
  mins: Vec3;
  maxs: Vec3;
}

export interface DoorOpening {
  /** World axis the opening runs along. */
  axis: "x" | "y";
  /** Opening extent on that axis. */
  min: number;
  max: number;
  /** Position on the other horizontal axis: the plane the door sits in. */
  at: number;
  /** Floor height the door's bottom should rest on. */
  floorZ: number;
}

export interface DoorPlacement {
  /** The entity origin: the hinge, already inset from the jamb. */
  origin: Vec3;
  /** The leaf's width along the opening. */
  width: number;
  /** Which jamb the hinge is nearest, in world terms. */
  hinge: "min" | "max";
  /** Unit direction the leaf extends from the hinge, horizontally. */
  extension: [number, number];
}

export class DoorPlacementError extends Error {}

/**
 * Places a door in an opening.
 *
 * `yaw` is the entity's yaw in degrees, the same value worldspawn's `angles` takes. The
 * model's local width axis is the larger horizontal extent; the sign tells which way the
 * leaf runs from its origin. The hinge is then put `inset` units inside the jamb the leaf
 * runs away from, so the origin is not inside the wall and the leaf covers the opening.
 */
export function placeDoor(args: {
  bounds: DoorBounds;
  opening: DoorOpening;
  yaw: number;
  /** Distance from the jamb to the hinge origin. Two units clears the wall face. */
  inset?: number;
}): DoorPlacement {
  const { bounds, opening, yaw } = args;
  const inset = args.inset ?? 2;
  const sizeX = bounds.maxs[0] - bounds.mins[0];
  const sizeY = bounds.maxs[1] - bounds.mins[1];
  if (!(sizeX > 0) || !(sizeY > 0)) {
    throw new DoorPlacementError("the model has no horizontal extent");
  }
  const widthAxis: 0 | 1 = sizeY >= sizeX ? 1 : 0;
  const width = widthAxis === 1 ? sizeY : sizeX;
  // The origin is at the hinge, so the leaf extends toward the farther hull edge.
  const extendsPositive = Math.abs(bounds.maxs[widthAxis]) > Math.abs(bounds.mins[widthAxis]);
  const localSign = extendsPositive ? 1 : -1;

  // Rotate the local width axis by yaw. Source: yaw turns local +X toward world +Y, so a
  // local +Y runs toward world -X at 90 degrees.
  const radians = (yaw * Math.PI) / 180;
  const localDir: [number, number] =
    widthAxis === 1 ? [-Math.sin(radians), Math.cos(radians)] : [Math.cos(radians), Math.sin(radians)];
  const extension: [number, number] = [localDir[0] * localSign, localDir[1] * localSign];

  const along = opening.axis === "x" ? extension[0] : extension[1];
  if (Math.abs(along) < 0.9) {
    throw new DoorPlacementError(
      `the door leaf runs across the opening: yaw ${yaw} gives an extension of ` +
        `(${extension[0].toFixed(2)}, ${extension[1].toFixed(2)}), but the opening is on ` +
        `${opening.axis}. Use a yaw that aligns the leaf with the opening.`,
    );
  }
  const openingWidth = opening.max - opening.min;
  if (width > openingWidth) {
    throw new DoorPlacementError(
      `the opening is ${openingWidth} units, narrower than the ${width.toFixed(1)}-unit door`,
    );
  }
  const hinge: "min" | "max" = along > 0 ? "min" : "max";
  const alongOrigin = along > 0 ? opening.min + inset : opening.max - inset;
  if (alongOrigin <= opening.min || alongOrigin >= opening.max) {
    throw new DoorPlacementError(
      `the opening is ${openingWidth} units, too narrow for a ${width.toFixed(1)}-unit door ` +
        `and a ${inset}-unit hinge inset`,
    );
  }

  const origin: Vec3 =
    opening.axis === "x"
      ? [alongOrigin, opening.at, round(bounds, opening.floorZ)]
      : [opening.at, alongOrigin, round(bounds, opening.floorZ)];

  return { origin, width, hinge, extension };
}

/** Origin z so the model's lowest point sits on the floor. */
function round(bounds: DoorBounds, floorZ: number): number {
  const z = floorZ - bounds.mins[2];
  return Math.round(z * 1000) / 1000;
}
