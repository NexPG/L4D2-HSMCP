/**
 * Reading the compiled static-prop lump.
 *
 * The numbers are pinned to `c1m1_hotel`, whose `sprp` lump is version 9 with a 72-byte
 * record: the game-lump id is stored as an int, so `sprp` arrives as `prps` in the bytes and
 * must be flipped back. A reader that assumes the bytes spell the name reports zero props on
 * every L4D2 map, which is exactly the silent omission this test exists to catch.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readStaticProps } from "../../src/maps/typescript/bsp/staticprops.js";
import { ctx, FIXTURES, has } from "../support/env.js";

describe.skipIf(!has.gameContent)("readStaticProps", () => {
  const map = (): string => join(ctx.config.gameDir!, "maps", "c1m1_hotel.bsp");

  it("reads every prop from c1m1_hotel", () => {
    const list = readStaticProps(map());
    expect(list.version).toBe(9);
    expect(list.stride).toBe(72);
    expect(list.models.length).toBe(188);
    expect(list.props.length).toBe(1748);
    const bed = list.props.find((prop) => prop.model.includes("hospital_bed"));
    expect(bed).toBeDefined();
    expect(bed!.origin[2]).toBeCloseTo(1184.2, 1);
    expect(bed!.angles[1]).toBeCloseTo(286.5, 3);
    expect(bed!.skin).toBe(0);
    expect(bed!.scale).toEqual([1, 1, 1]);
    expect(bed!.solidity).toBe(6);
  });

  it("returns an empty list for a map with no sprp lump", () => {
    const list = readStaticProps(join(FIXTURES, "hmcp_probe.bsp"));
    expect(list.props).toEqual([]);
    expect(list.models).toEqual([]);
  });
});
