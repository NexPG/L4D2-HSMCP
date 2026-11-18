import { describe, expect, it } from "vitest";
import { editWorldspawn } from "../../src/maps/typescript/vmf/portals.js";
import { VmfPortalError } from "../../src/maps/typescript/vmf/portals.js";

const MAP = `versioninfo
{
	"editorversion" "400"
}
world
{
	"id" "1"
	"classname" "worldspawn"
	"skyname" "sky_l4d_c1_1"
	"mapversion" "1"
	solid
	{
		"id" "2"
	}
}
`;

describe("editWorldspawn", () => {
  it("sets arbitrary keys, replacing an existing one", () => {
    const result = editWorldspawn(MAP, {
      skyname: "sky_l4d_c2_1",
      message: "No smoking",
      custom_key: "anything",
    });

    expect(result.changed["skyname"]).toEqual({ from: "sky_l4d_c1_1", to: "sky_l4d_c2_1" });
    expect(result.changed["message"]).toEqual({ from: null, to: "No smoking" });
    expect(result.text).toContain('"skyname" "sky_l4d_c2_1"');
    expect(result.text).toContain('"message" "No smoking"');
    expect(result.text).toContain('"custom_key" "anything"');
    expect(result.unchanged).toBe(false);
  });

  it("removes a key without touching the block's identity", () => {
    const result = editWorldspawn(MAP, {}, ["mapversion"]);
    expect(result.removed).toEqual(["mapversion"]);
    expect(result.text).not.toContain('"mapversion"');
    expect(result.text).toContain('"id" "1"');
    expect(result.text).toContain('"classname" "worldspawn"');
  });

  it("reports a key that was not there instead of pretending", () => {
    const result = editWorldspawn(MAP, {}, ["nothing_here"]);
    expect(result.removed).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/nothing to remove/);
    expect(result.unchanged).toBe(true);
  });

  it("protects id and classname", () => {
    expect(() => editWorldspawn(MAP, { id: "9" })).toThrow(VmfPortalError);
    expect(() => editWorldspawn(MAP, {}, ["classname"])).toThrow(/not a worldspawn/);
    expect(() => editWorldspawn(MAP, { classname: "func_detail" })).toThrow(/classname/);
  });

  it("refuses the same key set and removed, and an empty call", () => {
    expect(() => editWorldspawn(MAP, { message: "x" }, ["message"])).toThrow(/both set and removed/);
    expect(() => editWorldspawn(MAP)).toThrow(/no worldspawn keyvalues/);
    expect(() => editWorldspawn("versioninfo\n{\n}\n", { message: "x" })).toThrow(/no world block/);
  });
});
