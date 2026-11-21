/**
 * Collapsing instances: the inverse of `create_instance_from_selection`.
 *
 * The fixture is built from the same `emptyVmf`/`insertSolids` primitives the rest of the VMF
 * tests use, so the expected solids and origins are exact rather than representative. The
 * nested instance is deliberate: vbsp expands recursively, and a collapse that only handles
 * one level would leave a `func_instance` whose `file` no longer resolves from the target.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { collapseInstances, VmfCollapseError } from "../../src/maps/typescript/vmf/collapse.js";
import { emptyVmf } from "../../src/maps/typescript/vmf/skeleton.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import { get, parse } from "../../src/formats/typescript/kv/parse.js";
import { collapseInstancesTool } from "../../src/maps/typescript/tools/instancecollapse.js";
import { readVmf } from "../../src/maps/typescript/tools/vmf.js";
import { ctx as sharedCtx, has } from "../support/env.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import type { KvBlock } from "../../src/formats/typescript/kv/parse.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-collapse-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function box(text: string, mins: [number, number, number], maxs: [number, number, number]): string {
  return insertSolids(text, [{ shape: "box", mins, maxs }], {
    material: "BRICK/BRICKWALL001A",
  }).text;
}

function entity(
  text: string,
  id: number,
  classname: string,
  keyvalues: Record<string, string>,
  connections: Record<string, string> = {},
): string {
  const lines = [`entity`, `{`, `\t"id" "${id}"`, `\t"classname" "${classname}"`];
  for (const [key, value] of Object.entries(keyvalues)) {
    lines.push(`\t"${key}" "${value}"`);
  }
  if (Object.keys(connections).length > 0) {
    lines.push("\tconnections", "\t{");
    for (const [key, value] of Object.entries(connections)) {
      lines.push(`\t\t"${key}" "${value}"`);
    }
    lines.push("\t}");
  }
  lines.push("}", "");
  return text + lines.join("\n");
}

function entities(text: string): KvBlock[] {
  return parse(text).filter(
    (node): node is KvBlock => node.kind === "block" && node.name === "entity",
  );
}

describe("collapseInstances", () => {
  it("expands nested instances, applies prefix/postfix and turns the geometry", () => {
    const nested = entity(box(emptyVmf(), [0, 0, 0], [16, 16, 16]), 900, "info_target", {
      targetname: "lamp",
      origin: "4 4 4",
      angles: "0 0 0",
    });
    writeFileSync(join(scratch, "nested.vmf"), nested);

    const room = entity(
      entity(box(emptyVmf(), [0, 0, 0], [64, 64, 64]), 800, "info_target", {
        targetname: "door",
        origin: "10 0 0",
        angles: "0 0 0",
      }),
      801,
      "func_instance",
      {
        file: "nested.vmf",
        targetname: "nested",
        origin: "0 0 64",
        angles: "0 0 0",
        fixup_style: "1", // postfix
      },
    );
    writeFileSync(join(scratch, "room.vmf"), room);

    let target = box(emptyVmf(), [-256, -256, 0], [-192, -192, 64]);
    target = entity(
      entity(target, 701, "logic_auto", { origin: "0 0 64" }, {
        OnMapSpawn: "room-door,Hurt,,0,-1",
      }),
      700,
      "func_instance",
      {
        file: "room.vmf",
        targetname: "room",
        origin: "128 0 0",
        angles: "0 90 0",
        fixup_style: "0", // prefix
      },
    );

    const r = collapseInstances(target, join(scratch, "target.vmf"));
    expect(r.collapsed).toBe(2);
    expect(r.files.map((file) => file.endsWith("room.vmf") || file.endsWith("nested.vmf"))).toEqual([
      true,
      true,
    ]);
    expect(checkVmfSolids("(memory)", r.text).solidCount).toBe(3);

    const found = entities(r.text).map((block) => ({
      classname: get(block, "classname"),
      targetname: get(block, "targetname"),
      origin: get(block, "origin"),
      angles: get(block, "angles"),
    }));
    expect(found.some((entry) => entry.classname === "func_instance")).toBe(false);
    expect(found.find((entry) => entry.targetname === "room-door")).toMatchObject({
      origin: "128 10 0",
      angles: "0 90 0",
    });
    // nested: lamp gets `lamp-nested` (its own postfix), then `room-lamp-nested` (parent prefix)
    expect(found.find((entry) => entry.targetname === "room-lamp-nested")).toMatchObject({
      origin: "124 4 68",
      angles: "0 90 0",
    });
    expect(r.text).toContain('"OnMapSpawn" "room-door,Hurt,,0,-1"');
    expect(r.warnings).toEqual([]);
  });

  it("supports no fixup and keeps a classname output target unchanged", () => {
    const inner = entity(box(emptyVmf(), [0, 0, 0], [16, 16, 16]), 800, "info_target", {
      targetname: "marker",
      origin: "0 0 0",
    });
    writeFileSync(join(scratch, "plain.vmf"), inner);
    let target = entity(emptyVmf(), 700, "func_instance", {
      file: "plain.vmf",
      targetname: "unused",
      origin: "0 0 0",
      angles: "0 0 0",
      fixup_style: "2", // none
    });
    target = entity(target, 701, "logic_relay", { origin: "0 0 0" }, {
      OnTrigger: "info_target,Kill,,0,-1",
    });
    const r = collapseInstances(target, join(scratch, "plain-target.vmf"));
    const found = entities(r.text);
    expect(found.find((block) => get(block, "classname") === "info_target")).toBeDefined();
    expect(get(found.find((block) => get(block, "classname") === "info_target")!, "targetname")).toBe(
      "marker",
    );
    expect(r.text).toContain('"OnTrigger" "info_target,Kill,,0,-1"');
  });

  it("refuses a loop and a missing instance file", () => {
    const loopPath = join(scratch, "loop.vmf");
    const loop = entity(emptyVmf(), 700, "func_instance", {
      file: "loop.vmf",
      targetname: "loop",
      origin: "0 0 0",
      angles: "0 0 0",
      fixup_style: "0",
    });
    writeFileSync(loopPath, loop);
    expect(() => collapseInstances(loop, loopPath)).toThrow(VmfCollapseError);
    expect(() => collapseInstances(loop, loopPath)).toThrow(/instance loop/);

    const missing = entity(emptyVmf(), 700, "func_instance", {
      file: "no_such_instance.vmf",
      targetname: "missing",
      origin: "0 0 0",
      angles: "0 0 0",
      fixup_style: "0",
    });
    expect(() => collapseInstances(missing, join(scratch, "missing.vmf"))).toThrow(
      /instance file not found: no_such_instance\.vmf/,
    );
  });
});

describe("collapse_instances tool", () => {
  it("writes the collapsed map and reports the expansion", async () => {
    const inner = entity(box(emptyVmf(), [0, 0, 0], [16, 16, 16]), 800, "info_target", {
      targetname: "marker",
      origin: "1 2 3",
    });
    writeFileSync(join(scratch, "tool-inner.vmf"), inner);
    const target = entity(emptyVmf(), 700, "func_instance", {
      file: "tool-inner.vmf",
      targetname: "tool",
      origin: "0 0 0",
      angles: "0 0 0",
      fixup_style: "0",
    });
    const path = join(scratch, "tool-target.vmf");
    writeFileSync(path, target);
    const out = join(scratch, "tool-out.vmf");
    const r = (await collapseInstancesTool.handler(
      { path, out, confirm: true, backup: false, dryRun: false, maxDepth: 20 } as never,
      ctx,
    )) as { written: boolean; collapsed: number; files: string[]; warnings: string[] };
    expect(r.written).toBe(true);
    expect(r.collapsed).toBe(1);
    expect(r.files).toHaveLength(1);
    const written = readFileSync(out, "utf8");
    expect(written).toContain('"targetname" "tool-marker"');
    expect(written).not.toContain('"classname" "func_instance"');
  });
});

describe.skipIf(!has.sidecar)("collapse_instances vs the reference implementation", () => {
  it("matches srctools for a pitched, yawed and rolled instance", async () => {
    const inner = entity(box(emptyVmf(), [0, 0, 0], [16, 16, 16]), 800, "info_target", {
      targetname: "marker",
      origin: "10 20 30",
      angles: "5 15 25",
    });
    writeFileSync(join(scratch, "oracle-inner.vmf"), inner);
    const target = entity(emptyVmf(), 700, "func_instance", {
      file: "oracle-inner.vmf",
      targetname: "room",
      origin: "128 32 -16",
      angles: "30 40 50",
      fixup_style: "0",
    });
    const path = join(scratch, "oracle-target.vmf");
    const ours = collapseInstances(target, path);
    writeFileSync(join(scratch, "oracle-ours.vmf"), ours.text);
    const reference = (await readVmf.handler(
      { path: join(scratch, "oracle-ours.vmf"), limit: 100, collapseInstances: true } as never,
      ctx,
    )) as { entities: Array<{ targetname: string | null; origin: number[] | null; keyvalues: Record<string, string> }> };
    const oursEntity = parse(ours.text)
      .filter((node): node is KvBlock => node.kind === "block" && node.name === "entity")
      .map((block) => ({
        targetname: get(block, "targetname") ?? null,
        origin: (get(block, "origin") ?? "").split(/\s+/).map(Number),
        angles: get(block, "angles") ?? "",
      }))
      .find((entry) => entry.targetname === "room-marker")!;
    const refEntity = reference.entities.find((entry) => entry.targetname === "room-marker")!;
    expect(oursEntity.origin).toEqual(refEntity.origin);
    expect(oursEntity.angles).toBe(refEntity.keyvalues["angles"]);
  });
});
