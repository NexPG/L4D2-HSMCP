import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writePropTool } from "../../src/maps/typescript/tools/entityextras.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { FIXTURES, ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-props-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type PropReply = {
  classname: string;
  warnings: string[];
  clipAdded: boolean;
  clipBox: unknown;
};

async function writeProp(name: string, args: Record<string, unknown>): Promise<PropReply> {
  const path = join(scratch, `${name}.vmf`);
  copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), path);
  return (await writePropTool.handler(
    {
      path,
      origin: [0, 0, 16],
      confirm: true,
      ...args,
    } as never,
    ctx,
  )) as unknown as PropReply;
}

describe.skipIf(!has.gameContent)("write_prop model checks", () => {
  it("warns that a dynamic-only model cannot be prop_static and can add a clip", async () => {
    const r = await writeProp("bad-static", {
      kind: "static",
      model: "models/props_fairgrounds/arcadegame01.mdl",
      collision: "clip",
    });
    expect(r.classname).toBe("prop_static");
    expect(r.warnings.join(" ")).toMatch(/no \$staticprop|Deleted/);
    expect(r.clipAdded).toBe(true);
    expect(r.clipBox).not.toBeNull();
  }, 60_000);

  it("keeps a model that ships $staticprop quiet", async () => {
    const r = await writeProp("good-static", {
      kind: "static",
      model: "models/props_street/electrical_box02.mdl",
      collision: "none",
    });
    expect(r.classname).toBe("prop_static");
    expect(r.warnings.join(" ")).not.toMatch(/no \$staticprop/);
  }, 60_000);

  it("adds a clip hull for a model that ships no .phy, as the official maps do", async () => {
    // c1m1_hotel carries 60 no-.phy models, all scenery: skybox, rooftops, dead bodies.
    const r = await writeProp("no-phy", {
      kind: "static",
      model: "models/deadbodies/default/oval_128_b.mdl",
      collision: "auto",
    });
    expect(r.classname).toBe("prop_static");
    expect(r.warnings.join(" ")).toMatch(/has no \.phy/);
    expect(r.warnings.join(" ")).not.toMatch(/no \$staticprop/);
    expect(r.clipAdded).toBe(true);
  }, 60_000);

  it("writes movable clutter as prop_physics when collision says physics", async () => {
    // The official maps use prop_physics 11,667 times; a car or bench as prop_static is a wall.
    const r = await writeProp("physics-clutter", {
      model: "models/props/cs_office/trash_can.mdl",
      collision: "physics",
    });
    expect(r.classname).toBe("prop_physics");
    expect(r.clipAdded).toBe(false);
  }, 60_000);

  it("writes prop_dynamic when collision says dynamic, instead of a deleted prop_static", async () => {
    const r = await writeProp("dynamic-prop", {
      model: "models/props_fairgrounds/arcadegame01.mdl",
      collision: "dynamic",
    });
    expect(r.classname).toBe("prop_dynamic");
    expect(r.warnings.join(" ")).not.toMatch(/no \$staticprop|Deleted/);
  }, 60_000);
});
