/**
 * Editing the static-prop lump of a compiled map.
 *
 * The probe BSP has no props, so the test creates one through the tool and then reads the
 * saved file with srctools again. That exercises the whole path: parse, append, rebuild the
 * `sprp` lump, save, re-read. A skin change and a removal follow, and an index outside the
 * list must be refused instead of silently doing nothing.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { config, FIXTURES, has } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-props-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Prop {
  index: number;
  model: string;
  skin: number;
  solidity: number;
  origin: number[];
}

interface EditResult {
  out: string;
  count: number;
  changed: number[];
  props: Prop[];
  warnings: string[];
}

const installed = has.sidecar;

describe.skipIf(!installed)("static_props_edit", () => {
  it("adds, edits and removes a static prop in a compiled BSP", { timeout: 30_000 }, async () => {
    const first = join(scratch, "add.bsp");
    copyFileSync(join(FIXTURES, "hmcp_probe.bsp"), first);

    const added = await callSidecar<EditResult>(
      "static_props_edit",
      {
        path: first,
        out: join(scratch, "added.bsp"),
        ops: [
          {
            op: "add",
            model: "models/props_junk/gascan001a.mdl",
            origin: [32, 64, 8],
            skin: 1,
            solidity: 2,
          },
        ],
      },
      config,
    );
    expect(added.count).toBe(1);
    expect(added.changed).toEqual([0]);
    expect(added.props[0]!.model).toBe("models/props_junk/gascan001a.mdl");
    expect(added.props[0]!.skin).toBe(1);
    expect(added.props[0]!.solidity).toBe(2);
    expect(added.props[0]!.origin).toEqual([32, 64, 8]);
    expect(added.warnings.join(" ")).toMatch(/visleafs/);

    const edited = await callSidecar<EditResult>(
      "static_props_edit",
      {
        path: added.out,
        out: join(scratch, "edited.bsp"),
        ops: [{ op: "set", index: 0, skin: 3, tint: [255, 0, 0] }],
      },
      config,
    );
    expect(edited.props[0]!.skin).toBe(3);

    const removed = await callSidecar<EditResult>(
      "static_props_edit",
      {
        path: edited.out,
        out: join(scratch, "removed.bsp"),
        ops: [{ op: "remove", index: 0 }],
      },
      config,
    );
    expect(removed.count).toBe(0);
    expect(removed.props).toEqual([]);
  });

  it("refuses an index that is not in the prop list", async () => {
    const path = join(scratch, "bad.bsp");
    copyFileSync(join(FIXTURES, "hmcp_probe.bsp"), path);
    await expect(
      callSidecar(
        "static_props_edit",
        { path, ops: [{ op: "set", index: 7, skin: 1 }] },
        config,
      ),
    ).rejects.toThrow(/outside 0-/);
  });
});
