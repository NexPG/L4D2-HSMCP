/**
 * Autosaves: the recovery path that depends on knowing three editor-specific locations.
 *
 * Two assertions carry the weight. First, an autosave is matched to its map by the
 * `originalname` inside `versioninfo`, not by file name — two maps called `test.vmf` in
 * different folders are not the same map, and offering the wrong one is worse than offering
 * none. Second, "newer than the map" is decided by mtime, because a list of autosaves that
 * does not say which one wins is a list the caller has to sort by hand.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  autosavesForMap,
  hammerPlusPlusAutosaveFolder,
  isAbsoluteWindowsPath,
  resolveAutosaveFolder,
} from "../../src/game/autosave.js";
import type { ToolContext } from "../../src/mcp/registry.js";
import { readAutosavesTool, restoreAutosaveTool } from "../../src/tools/autosave.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-autosave-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function vmf(original: string, version: number): string {
  return `versioninfo
{
	"editorversion" "400"
	"editorbuild" "8873"
	"mapversion" "${version}"
	"formatversion" "100"
	"originalname" "${original}"
}
world
{
	"id" "1"
	"classname" "worldspawn"
}
`;
}

describe("autosave discovery", () => {
  it("matches an autosave to its map through originalname, not the file name", () => {
    const folder = join(scratch, "saves");
    mkdirSync(folder, { recursive: true });
    const mapA = join(scratch, "maps", "a", "test.vmf");
    const mapB = join(scratch, "maps", "b", "test.vmf");
    mkdirSync(join(scratch, "maps", "a"), { recursive: true });
    mkdirSync(join(scratch, "maps", "b"), { recursive: true });
    writeFileSync(mapA, vmf(mapA, 3));
    writeFileSync(mapB, vmf(mapB, 9));

    writeFileSync(join(folder, "test_001.vmf_autosave"), vmf(mapA, 4));
    writeFileSync(join(folder, "test_002.vmf_autosave"), vmf(mapB, 10));
    // Same base name, no originalname: kept, because a truncated file is more likely than a
    // different map that happens to share the name.
    writeFileSync(join(folder, "test_003.vmf_autosave"), "world\n{\n}\n");

    const found = autosavesForMap(folder, mapA);
    expect(found.map((a) => a.file).sort()).toEqual(["test_001.vmf_autosave", "test_003.vmf_autosave"]);
    expect(found.find((a) => a.file === "test_001.vmf_autosave")?.mapVersion).toBe(4);
    expect(found.find((a) => a.file === "test_001.vmf_autosave")?.originalName).toBe(mapA);

    // A map that does not exist yet still gets its autosaves: that is the whole point.
    const gone = join(scratch, "maps", "a", "gone.vmf");
    expect(autosavesForMap(folder, gone)).toEqual([]);
  });

  it("orders newest first and says which is newer than the saved map", () => {
    const folder = join(scratch, "saves2");
    mkdirSync(folder, { recursive: true });
    const map = join(scratch, "maps", "c", "quick.vmf");
    mkdirSync(join(scratch, "maps", "c"), { recursive: true });
    writeFileSync(map, vmf(map, 1));

    const older = join(folder, "quick_001.vmf_autosave");
    const newer = join(folder, "quick_002.vmf_autosave");
    writeFileSync(older, vmf(map, 2));
    writeFileSync(newer, vmf(map, 3));
    const now = Date.now() / 1000;
    utimesSync(map, now - 300, now - 300);
    utimesSync(older, now - 200, now - 200);
    utimesSync(newer, now - 100, now - 100);

    const found = autosavesForMap(folder, map);
    expect(found.map((a) => a.file)).toEqual(["quick_002.vmf_autosave", "quick_001.vmf_autosave"]);
    expect(found.every((a) => a.newerThanMap)).toBe(true);
  });

  it("reads Hammer++'s autosave settings from its ini", () => {
    const ini = join(scratch, "hammerplusplus", "hammerplusplus_settings.ini");
    mkdirSync(join(scratch, "hammerplusplus"), { recursive: true });
    writeFileSync(
      ini,
      "[General]\nAutosaveEnabled=1\nAutosaveDir=C:\\Users\\user\\Documents\\HammerAutosaves\n\n[Other]\nAutosaveDir=ignored\n",
    );
    expect(hammerPlusPlusAutosaveFolder(ini)).toEqual({
      folder: "C:\\Users\\user\\Documents\\HammerAutosaves",
      enabled: true,
    });
    expect(hammerPlusPlusAutosaveFolder(join(scratch, "nope.ini"))).toBeNull();
    expect(isAbsoluteWindowsPath("C:\\maps")).toBe(true);
    expect(isAbsoluteWindowsPath("\\\\server\\share")).toBe(true);
    expect(isAbsoluteWindowsPath("autosave")).toBe(false);
  });

  it("refuses a relative autosave folder instead of reporting an empty list", () => {
    const bin = join(scratch, "bin-relative");
    mkdirSync(join(bin, "hammerplusplus"), { recursive: true });
    writeFileSync(
      join(bin, "hammerplusplus", "hammerplusplus_settings.ini"),
      "[General]\nAutosaveDir=\\autosave\\\nAutosaveEnabled=1\n",
    );
    const resolved = resolveAutosaveFolder({ plusPlusBinDir: bin });
    expect(resolved.folder).toBeNull();
    expect(resolved.enabled).toBe(false);
    expect(resolved.detail).toMatch(/not an absolute path/);
  });
});

describe("autosave tools", () => {
  it("lists the autosaves of a map and restores one as a .vmf", async () => {
    const folder = join(scratch, "saves3");
    mkdirSync(folder, { recursive: true });
    const mapDir = join(scratch, "maps", "d");
    mkdirSync(mapDir, { recursive: true });
    const map = join(mapDir, "c2m1.vmf");
    writeFileSync(map, vmf(map, 5));
    const autosave = join(folder, "c2m1_014.vmf_autosave");
    writeFileSync(autosave, vmf(map, 14));
    // Two files written in the same millisecond compare equal, and "newer" is strictly ">".
    const now = Date.now() / 1000;
    utimesSync(map, now - 60, now - 60);
    utimesSync(autosave, now, now);

    const listed = (await readAutosavesTool.handler({ map, folder }, ctx)) as {
      count: number;
      folderSource: string;
      enabled: boolean;
      autosaves: Array<{ file: string; mapVersion: number; newerThanMap: boolean }>;
      advice: string;
    };
    expect(listed.folderSource).toBe("argument");
    expect(listed.enabled).toBe(true);
    expect(listed.count).toBe(1);
    expect(listed.autosaves[0]).toMatchObject({
      file: "c2m1_014.vmf_autosave",
      mapVersion: 14,
      newerThanMap: true,
    });
    expect(listed.advice).toMatch(/newer than the saved map/);

    const out = join(mapDir, "c2m1_recovered.vmf");
    const restored = (await restoreAutosaveTool.handler(
      { autosave, out, overwrite: false, confirm: true },
      ctx,
    )) as { written: boolean; mapVersion: number; warnings: string[] };
    expect(restored.written).toBe(true);
    expect(restored.mapVersion).toBe(14);
    expect(restored.warnings).toEqual([]);
    expect(readFileSync(out, "utf8")).toBe(vmf(map, 14));

    expect(() =>
      restoreAutosaveTool.handler({ autosave, out, overwrite: false, confirm: true }, ctx),
    ).toThrow(/already exists/);
  });

  it("says why the list is empty instead of pretending there is nothing", async () => {
    const map = join(scratch, "maps", "d", "c2m1.vmf");
    const listed = (await readAutosavesTool.handler(
      { map, folder: join(scratch, "does-not-exist") },
      ctx,
    )) as { count: number; advice: string };
    expect(listed.count).toBe(0);
    expect(listed.advice).toMatch(/No autosave/);
  });

  it("refuses a file that is not an autosave and a target that is not a .vmf", () => {
    const map = join(scratch, "maps", "d", "c2m1.vmf");
    expect(() =>
      restoreAutosaveTool.handler({ autosave: map, out: join(scratch, "x.vmf"), overwrite: false, confirm: true }, ctx),
    ).toThrow(/not a .vmf_autosave/);

    const autosave = join(scratch, "saves3", "c2m1_014.vmf_autosave");
    expect(() =>
      restoreAutosaveTool.handler(
        { autosave, out: join(scratch, "x.txt"), overwrite: false, confirm: true },
        ctx,
      ),
    ).toThrow(/not a .vmf path/);
  });
});
