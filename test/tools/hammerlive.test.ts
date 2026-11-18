import { describe, expect, it } from "vitest";
import { shellCommandsFor } from "../../src/tools/hammerlive.js";

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
