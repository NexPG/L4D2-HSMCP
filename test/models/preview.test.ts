/**
 * The preview room's arithmetic, without a compiler.
 *
 * What goes wrong in a preview is placement: a model whose origin is at its feet and one
 * whose origin is at its waist need different world Z for the same bottom, and getting it
 * wrong produces a screenshot that looks plausible until the prop is half in the pedestal.
 * The room is a pure function so this can be checked in milliseconds instead of a five
 * minute compile, and `buildPreviewRoom` is the same code the tool runs.
 */
import { describe, expect, it } from "vitest";
import {
  PREVIEW_PEDESTAL,
  buildPreviewRoom,
  viewportIsBlank,
} from "../../src/models/typescript/tools/preview.js";
import { applyVmfOps } from "../../src/maps/typescript/vmf/edit.js";

const MODEL = "models/props_junk/wood_crate001a.mdl";

describe("preview room", () => {
  it("puts a feet-origin model's bottom on the pedestal", () => {
    const mins = [-16, -16, 0];
    const room = buildPreviewRoom(MODEL, mins, [32, 32, 40], 1);
    expect(room.originZ).toBe(PREVIEW_PEDESTAL);
    expect(room.originZ + mins[2]! * 1).toBe(PREVIEW_PEDESTAL);
  });

  it("compensates a centre-origin model and applies modelscale", () => {
    const mins = [-20, -20, -26];
    const scale = 2;
    const room = buildPreviewRoom(MODEL, mins, [40, 40, 52], scale);
    expect(room.originZ).toBe(PREVIEW_PEDESTAL - mins[2]! * scale);
    expect(room.originZ + mins[2]! * scale).toBe(PREVIEW_PEDESTAL);
  });

  it("grows the room with the model instead of clipping it", () => {
    const small = buildPreviewRoom(MODEL, [0, 0, 0], [16, 16, 16], 1);
    const large = buildPreviewRoom(MODEL, [0, 0, 0], [512, 512, 512], 1);
    expect(small.ceiling).toBeGreaterThanOrEqual(224);
    expect(large.ceiling).toBeGreaterThan(small.ceiling);
    expect(large.half).toBeGreaterThan(small.half);
    // The ceiling is above the model's top: the point of sizing it from `size`.
    expect(large.ceiling).toBeGreaterThan(512);
  });

  it("writes a VMF the parser accepts, with the player facing the model", () => {
    const room = buildPreviewRoom(MODEL, [-16, -16, -6], [32, 32, 40], 1);
    const parsed = applyVmfOps(room.text, [
      { op: "add", keyvalues: { classname: "info_target", targetname: "probe" } },
    ]);
    expect(parsed.entitiesBefore).toBe(6);
    expect(parsed.entitiesAfter).toBe(7);
    expect(room.text).toContain('"classname" "prop_dynamic_override"');
    expect(room.text).toContain(`"origin" "${-room.half + 48} 0 16"`);
    expect(room.text).toContain('"angles" "0 0 0"');
    expect(room.text.match(/"classname" "light"/g)?.length).toBe(2);
  });
});

describe("blank viewport test", () => {
  it("calls a flat capture blank and a rendered one not blank", () => {
    expect(viewportIsBlank(0)).toBe(true);
    expect(viewportIsBlank(2.9)).toBe(true);
    expect(viewportIsBlank(3)).toBe(false);
    expect(viewportIsBlank(18)).toBe(false);
  });
});
