import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { editEntityText, writeBspEntities, BspEditError } from "../../src/maps/typescript/bsp/edit.js";
import { readEntityLump } from "../../src/maps/typescript/bsp/entities.js";
import { readAt, readHeader } from "../../src/maps/typescript/bsp/header.js";
import { FIXTURES } from "../support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.bsp");
const lump = readEntityLump(PROBE);
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-bspedit-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("editEntityText", () => {
  it("adds an entity and keeps every existing one", () => {
    const result = editEntityText(lump.text, [
      {
        op: "add",
        keyvalues: { classname: "point_servercommand", targetname: "hsmcp_cmd" },
      },
    ]);
    expect(result.entitiesBefore).toBe(lump.entities.length);
    expect(result.entitiesAfter).toBe(lump.entities.length + 1);
    expect(result.text).toContain('"classname" "point_servercommand"');
    expect(result.text).toContain('"targetname" "hsmcp_cmd"');
    expect(result.outcomes[0]).toMatchObject({ op: "add", index: lump.entities.length });
  });

  it("updates and removes by classname or index", () => {
    const added = editEntityText(lump.text, [
      { op: "add", keyvalues: { classname: "info_target", targetname: "old" } },
    ]).text;
    const updated = editEntityText(added, [
      {
        op: "update",
        match: { targetname: "old" },
        keyvalues: { targetname: "new", custom: "1" },
      },
    ]);
    expect(updated.text).toContain('"targetname" "new"');
    expect(updated.text).toContain('"custom" "1"');
    expect(updated.text).not.toContain('"targetname" "old"');

    const removed = editEntityText(updated.text, [
      { op: "remove", match: { targetname: "new" } },
    ]);
    expect(removed.entitiesAfter).toBe(updated.entitiesAfter - 1);
    expect(removed.text).not.toContain('"targetname" "new"');
  });

  it("refuses an empty op list, an unmatched op and a lump without worldspawn", () => {
    expect(() => editEntityText(lump.text, [])).toThrow(BspEditError);
    expect(() =>
      editEntityText(lump.text, [{ op: "remove", match: { targetname: "not_here" } }]),
    ).toThrow(/nothing matched/);
    expect(() =>
      editEntityText(lump.text, [{ op: "remove", match: { classname: "worldspawn" } }]),
    ).toThrow(/no worldspawn/);
  });
});

describe("writeBspEntities", () => {
  it("appends the new lump and points the header at it", () => {
    const out = join(scratch, "entities.bsp");
    const before = statSync(PROBE).size;
    const result = writeBspEntities(
      PROBE,
      [{ op: "add", keyvalues: { classname: "point_servercommand", targetname: "cmd" } }],
      { out },
    );

    expect(result.written).toBe(true);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(before);
    expect(result.lumpOffset).toBe(before);

    const header = readHeader(out);
    const entry = header.lumps[0]!;
    expect(entry.offset).toBe(before);
    expect(entry.length).toBe(result.lumpBytes);
    const raw = readAt(out, entry.offset, entry.length);
    expect(raw.toString("utf8")).toContain('"classname" "point_servercommand"');

    const after = readEntityLump(out);
    expect(after.entities.length).toBe(lump.entities.length + 1);
    expect(after.entities.some((e) => e.classname === "point_servercommand")).toBe(true);
  });

  it("leaves the input alone when writing a new file", () => {
    const beforeText = readEntityLump(PROBE).text;
    const out = join(scratch, "copy.bsp");
    writeBspEntities(
      PROBE,
      [{ op: "add", keyvalues: { classname: "info_target", targetname: "copy" } }],
      { out },
    );
    expect(readEntityLump(PROBE).text).toBe(beforeText);
  });

  it("backs up when writing in place", () => {
    const path = join(scratch, "inplace.bsp");
    copyFileSync(PROBE, path);
    const result = writeBspEntities(
      path,
      [{ op: "add", keyvalues: { classname: "info_target", targetname: "inplace" } }],
      { backup: true },
    );
    expect(result.backupPath).toBe(`${path}.bak`);
    expect(existsSync(`${path}.bak`)).toBe(true);
    expect(readEntityLump(path).entities.some((e) => e.targetname === "inplace")).toBe(true);
    expect(readEntityLump(`${path}.bak`).entities.length).toBe(lump.entities.length);
  });
});
