import { describe, expect, it } from "vitest";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { applyCordon } from "../../src/maps/typescript/vmf/cordon.js";
import { applyVmfOps, readEntities } from "../../src/maps/typescript/vmf/edit.js";
import { setCordon } from "../../src/maps/typescript/vmf/organise.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n\tskyname "sky_l4d_c1_1_hdr"\n}\n';

const CORDON = { mins: [-200, -200, -100] as const, maxs: [200, 200, 200] as const };

/** A map with brushes and entities on both sides of the cordon box. */
function bothSides(): { text: string; inside: number; outside: number[] } {
  const first = insertSolids(SEED, [{ shape: "box", mins: [-64, -64, 0], maxs: [64, 64, 64] }], {
    material: "DEV/DEV_MEASUREGENERIC01",
  });
  const second = insertSolids(first.text, [
    { shape: "box", mins: [1024, 0, 0], maxs: [1152, 128, 64] },
    { shape: "box", mins: [1200, 0, 0], maxs: [1328, 128, 64] },
  ]);
  const entities = applyVmfOps(second.text, [
    { op: "add", keyvalues: { classname: "info_player_start", origin: "0 0 16" } },
    { op: "add", keyvalues: { classname: "light", origin: "0 0 96", _light: "255 255 255 200" } },
    { op: "add", keyvalues: { classname: "light", origin: "1088 64 32", _light: "255 255 255 200" } },
  ]);
  return {
    text: entities.text,
    inside: first.solidIds[0]!,
    outside: [second.solidIds[0]!, second.solidIds[1]!],
  };
}

describe("applyCordon", () => {
  it("keeps the box and drops everything outside it", () => {
    const map = bothSides();
    const cordoned = setCordon(map.text, { mins: CORDON.mins, maxs: CORDON.maxs }, { active: true });
    const r = applyCordon(cordoned.text);

    expect(r.applied).toBe(true);
    expect(r.active).toBe(true);
    expect(r.boxes).toHaveLength(1);
    expect(r.removedSolids).toBe(2);
    expect(r.removedEntities).toBe(1);

    const solids = checkVmfSolids("x", r.text).solids;
    expect(solids.map((s) => s.id)).toEqual([map.inside]);
    const lights = readEntities(r.text).entities.filter((e) => e.classname === "light");
    expect(lights).toHaveLength(1);
    expect(r.text).toContain('"origin" "0 0 96"');
    expect(r.text).not.toContain('"origin" "1088 64 32"');
    expect(readEntities(r.text).entities.some((e) => e.classname === "info_player_start")).toBe(true);
  });

  it("keeps a brush that straddles the edge, because clipping it would change the map", () => {
    const map = insertSolids(SEED, [
      { shape: "box", mins: [-500, -64, 0], maxs: [64, 64, 64] },
    ]);
    const cordoned = setCordon(map.text, { mins: CORDON.mins, maxs: CORDON.maxs }, { active: true });
    const r = applyCordon(cordoned.text);
    expect(r.applied).toBe(false);
    expect(r.removedSolids).toBe(0);
    expect(checkVmfSolids("x", r.text).solidCount).toBe(1);
  });

  it("does nothing when the cordon is off", () => {
    const map = bothSides();
    const cordoned = setCordon(map.text, { mins: CORDON.mins, maxs: CORDON.maxs }, { active: false });
    const r = applyCordon(cordoned.text);
    expect(r.active).toBe(false);
    expect(r.applied).toBe(false);
    expect(r.text).toBe(cordoned.text);
  });

  it("does nothing when asked to ignore an active cordon", () => {
    const map = bothSides();
    const cordoned = setCordon(map.text, { mins: CORDON.mins, maxs: CORDON.maxs }, { active: true });
    const r = applyCordon(cordoned.text, { ignore: true });
    expect(r.active).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.text).toBe(cordoned.text);
    expect(r.warnings.join(" ")).toMatch(/whole map/);
  });

  it("drops a brush entity only when every one of its brushes is outside", () => {
    const map = bothSides();
    const withEntity = applyVmfOps(map.text, [
      { op: "add", keyvalues: { classname: "func_detail" } },
      { op: "add", keyvalues: { classname: "func_detail" } },
    ]);
    const [insideEntity, outsideEntity] = withEntity.outcomes.map((o) => o.ids[0]!);
    const insideBrush = insertSolids(
      withEntity.text,
      [{ shape: "box", mins: [-32, -32, 0], maxs: [32, 32, 32] }],
      { entityId: insideEntity },
    );
    const outsideBrush = insertSolids(
      insideBrush.text,
      [{ shape: "box", mins: [1400, 0, 0], maxs: [1500, 64, 64] }],
      { entityId: outsideEntity! },
    );
    const cordoned = setCordon(outsideBrush.text, { mins: CORDON.mins, maxs: CORDON.maxs }, { active: true });

    const r = applyCordon(cordoned.text);
    const owners = checkVmfSolids("x", r.text).solids.map((s) => s.owner);
    expect(owners.filter((o) => o === "func_detail")).toHaveLength(1);
    expect(r.text).not.toContain(`"id" "${outsideEntity}"`);
  });

  it("keeps an entity that has no origin, and says it could not place it", () => {
    const map = bothSides();
    const withGlobal = applyVmfOps(map.text, [
      { op: "add", keyvalues: { classname: "env_global", globalstate: "TEST" } },
    ]);
    const cordoned = setCordon(withGlobal.text, { mins: CORDON.mins, maxs: CORDON.maxs }, { active: true });
    const r = applyCordon(cordoned.text);
    expect(r.text).toContain('"classname" "env_global"');
    expect(r.warnings.join(" ")).toMatch(/has no origin/);
  });

  it("says so when the cordon is on but every box is empty", () => {
    const map = bothSides();
    const empty = 'cordons\n{\n\t"active" "1"\n\tcordon\n\t{\n\t\t"name" "bad"\n' +
      '\t\t"active" "1"\n\t\tbox\n\t\t{\n\t\t\t"mins" "(0 0 0)"\n\t\t\t"maxs" "(0 0 0)"\n\t\t}\n\t}\n}\n';
    const r = applyCordon(`${map.text}${empty}`);
    expect(r.active).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/no active box/);
  });
});
