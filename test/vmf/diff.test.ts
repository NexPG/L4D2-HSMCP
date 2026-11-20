import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { diffVmfTool } from "../../src/maps/typescript/tools/diff.js";
import { diffVmf } from "../../src/maps/typescript/vmf/diff.js";
import { applyVmfOps } from "../../src/maps/typescript/vmf/edit.js";
import { setFaceMaterial } from "../../src/maps/typescript/vmf/face.js";
import { deleteSolids } from "../../src/maps/typescript/vmf/modify.js";
import { setMapProperties } from "../../src/maps/typescript/vmf/portals.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-diff-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n\t"skyname" "sky_day01_01"\n}\n';

function base(): { text: string; room: number; block: number; light: number } {
  const room = insertSolids(SEED, [
    { shape: "box", mins: [-256, -256, -32], maxs: [256, 256, 0] },
  ], { material: "DEV/DEV_MEASUREGENERIC01" });
  const block = insertSolids(room.text, [
    { shape: "box", mins: [-64, -64, 0], maxs: [64, 64, 64] },
  ], { material: "DEV/DEV_MEASUREGENERIC01" });
  const entities = applyVmfOps(block.text, [
    { op: "add", keyvalues: { classname: "light", targetname: "l1", origin: "0 0 32" } },
    { op: "add", keyvalues: { classname: "info_player_start", origin: "0 0 16" } },
  ]);
  const light = entities.outcomes[0]!.ids[0]!;
  return { text: entities.text, room: room.solidIds[0]!, block: block.solidIds[0]!, light };
}

describe("diffVmf", () => {
  it("reports a removed brush, an added brush and a changed material", () => {
    const before = base();
    let after = deleteSolids(before.text, { ids: [before.block] }).text;
    const added = insertSolids(after, [
      { shape: "box", mins: [64, 64, 0], maxs: [128, 128, 32] },
    ], { material: "DEV/DEV_MEASUREGENERIC01" });
    after = added.text;

    const side = checkVmfSolids("x", after).solids.find((s) => s.id === before.room)!.sides[0]!;
    after = setFaceMaterial(after, { sideIds: [side.id!] }, "BRICK/BRICKWALL001A").text;

    const diff = diffVmf(before.text, after);
    expect(diff.unchanged).toBe(false);
    expect(diff.solids.removed.map((s) => s.id)).toContain(before.block);
    expect(diff.solids.added.map((s) => s.id)).toContain(added.solidIds[0]);
    const changed = diff.solids.changed.find((s) => s.id === before.room);
    expect(changed?.fields).toContain("materials");
  });

  it("reports a moved entity, a new entity and a worldspawn key", () => {
    const before = base();
    const afterMoved = applyVmfOps(before.text, [
      { op: "update", match: { targetname: "l1" }, set: { origin: "0 0 64" } },
      { op: "add", keyvalues: { classname: "light", targetname: "l2", origin: "0 0 96" } },
    ]);
    const afterProps = setMapProperties(afterMoved.text, { skyname: "sky_l4d_c1_1_hdr" });

    const diff = diffVmf(before.text, afterProps.text);
    const moved = diff.entities.changed.find((e) => e.id === before.light);
    expect(moved?.fields).toContain('"origin"');
    expect(diff.entities.added.map((e) => e.targetname)).toContain("l2");
    expect(diff.worldspawn).toContainEqual({
      key: "skyname",
      before: "sky_day01_01",
      after: "sky_l4d_c1_1_hdr",
    });
  });

  it("is unchanged for byte-identical files", () => {
    const before = base();
    const diff = diffVmf(before.text, before.text);
    expect(diff.unchanged).toBe(true);
    expect(diff.solids.added).toEqual([]);
    expect(diff.entities.changed).toEqual([]);
    expect(diff.worldspawn).toEqual([]);
  });

  it("compares two files through the tool and limits each list", () => {
    const before = base();
    const after = deleteSolids(before.text, { ids: [before.block] }).text;
    const beforeFile = join(scratch, "before.vmf");
    const afterFile = join(scratch, "after.vmf");
    writeFileSync(beforeFile, before.text);
    writeFileSync(afterFile, after);

    const reply = diffVmfTool.handler(
      { before: beforeFile, after: afterFile, limit: 1 } as never,
      ctx,
    ) as unknown as {
      unchanged: boolean;
      summary: string;
      counts: { solidsBefore: number; solidsAfter: number };
      solids: { removed: Array<{ id: number | null }>; truncated: boolean };
    };
    expect(reply.unchanged).toBe(false);
    expect(reply.summary).toMatch(/1 solid\(s\) added|1 solid\(s\) removed/);
    expect(reply.counts.solidsAfter).toBe(reply.counts.solidsBefore - 1);
    expect(reply.solids.removed[0]?.id).toBe(before.block);
    expect(reply.solids.truncated).toBe(false);
  });
});
