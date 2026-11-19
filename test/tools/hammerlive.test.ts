import { describe, expect, it } from "vitest";
import {
  checkLiveAddresses,
  shellCommandsFor,
} from "../../src/hammer/typescript/tools/hammerlive.js";

const VMF = [
  "versioninfo",
  "{",
  '\t"mapversion" "1"',
  "}",
  "world",
  "{",
  '\t"id" "1"',
  '\t"classname" "worldspawn"',
  "}",
  "entity",
  "{",
  '\t"id" "2"',
  '\t"classname" "light"',
  '\t"origin" "0 0 0"',
  '\t"_light" "255 255 255 200"',
  "}",
  "entity",
  "{",
  '\t"id" "3"',
  '\t"classname" "light"',
  '\t"origin" "64 0 0"',
  "}",
].join("\n");

describe("Hammer shell commands", () => {
  it("creates an entity and sets its keyvalues", () => {
    const cmds = shellCommandsFor({
      op: "create",
      classname: "light",
      origin: [0, 0, 128],
      keyvalues: { _light: "255 255 255 200" },
    });
    expect(cmds).toEqual([
      "entity_create light 0 0 128",
      'entity_set_keyvalue light 0 0 128 "_light" "255 255 255 200"',
    ]);
  });

  it("formats a keyvalue edit and a deletion", () => {
    expect(
      shellCommandsFor({
        op: "setKeyvalue",
        classname: "prop_dynamic",
        origin: [1.5, -2, 3],
        key: "model",
        value: "models/props_junk/gascan001a.mdl",
      }),
    ).toEqual([
      'entity_set_keyvalue prop_dynamic 1.5 -2 3 "model" "models/props_junk/gascan001a.mdl"',
    ]);
    expect(
      shellCommandsFor({ op: "delete", classname: "light", origin: [0, 0, 128] }),
    ).toEqual(["entity_delete light 0 0 128"]);
  });

  it("sends incremental rotation in degrees", () => {
    expect(
      shellCommandsFor({
        op: "rotate",
        classname: "prop_dynamic",
        origin: [0, 0, 0],
        angles: [0, 90, 0],
      }),
    ).toEqual(["entity_rotate_incremental prop_dynamic 0 0 0 0 90 0"]);
  });

  it("refuses a create where an entity of the class already sits", () => {
    expect(
      checkLiveAddresses(VMF, [
        { op: "create", classname: "light", origin: [0, 0, 0] },
      ]),
    ).toMatch(/already exist/);
    expect(
      checkLiveAddresses(VMF, [
        { op: "create", classname: "light", origin: [128, 0, 0] },
      ]),
    ).toBeNull();
  });

  it("refuses an edit with no entity, or with more than one at the address", () => {
    expect(
      checkLiveAddresses(VMF, [
        { op: "delete", classname: "light", origin: [32, 0, 0] },
      ]),
    ).toMatch(/no light at/);
    const ambiguous = VMF.replace('"origin" "64 0 0"', '"origin" "0 0 0"');
    expect(
      checkLiveAddresses(ambiguous, [
        {
          op: "setKeyvalue",
          classname: "light",
          origin: [0, 0, 0],
          key: "_light",
          value: "255 0 0 200",
        },
      ]),
    ).toMatch(/share the origin/);
  });

  it("tracks a create and a delete earlier in the same call", () => {
    expect(
      checkLiveAddresses(VMF, [
        { op: "create", classname: "info_target", origin: [0, 0, 96] },
        {
          op: "setKeyvalue",
          classname: "info_target",
          origin: [0, 0, 96],
          key: "targetname",
          value: "probe",
        },
      ]),
    ).toBeNull();
    expect(
      checkLiveAddresses(VMF, [
        { op: "create", classname: "info_target", origin: [0, 0, 96] },
        { op: "create", classname: "info_target", origin: [0, 0, 96] },
      ]),
    ).toMatch(/already exist/);
    expect(
      checkLiveAddresses(VMF, [
        { op: "delete", classname: "light", origin: [64, 0, 0] },
        { op: "delete", classname: "light", origin: [64, 0, 0] },
      ]),
    ).toMatch(/no light at/);
  });

  it("refuses a quote that the shell has no escaping for", () => {
    expect(() =>
      shellCommandsFor({
        op: "setKeyvalue",
        classname: "light",
        origin: [0, 0, 0],
        key: "_light",
        value: '255 " 255 255 200',
      }),
    ).toThrow(/no escaping/);
  });
});
