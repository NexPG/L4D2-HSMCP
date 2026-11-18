import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hideFiles, restoreFiles, stageMapPair } from "../../src/game/stage.js";

const made: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hsmcp-stage-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("stageMapPair", () => {
  it("installs a pair, then restores what was there", () => {
    const gameDir = tempDir();
    const maps = join(gameDir, "maps");
    mkdirSync(maps, { recursive: true });
    writeFileSync(join(maps, "m.bsp"), "old-bsp");
    writeFileSync(join(maps, "m.nav"), "old-nav");
    const source = tempDir();
    writeFileSync(join(source, "m.bsp"), "new-bsp");
    writeFileSync(join(source, "m.nav"), "new-nav");

    const staged = stageMapPair({
      gameDir,
      map: "m",
      bsp: join(source, "m.bsp"),
      nav: join(source, "m.nav"),
    });
    expect(readFileSync(join(maps, "m.bsp"), "utf8")).toBe("new-bsp");
    expect(readFileSync(join(maps, "m.nav"), "utf8")).toBe("new-nav");
    expect(staged.bspInstalled).toBe(true);
    expect(staged.navInstalled).toBe(true);

    staged.restore();
    expect(readFileSync(join(maps, "m.bsp"), "utf8")).toBe("old-bsp");
    expect(readFileSync(join(maps, "m.nav"), "utf8")).toBe("old-nav");
  });

  it("removes a map it installed when there was nothing there before", () => {
    const gameDir = tempDir();
    const source = tempDir();
    writeFileSync(join(source, "m.bsp"), "new-bsp");
    const staged = stageMapPair({ gameDir, map: "m", bsp: join(source, "m.bsp") });
    staged.restore();
    expect(() => readFileSync(join(gameDir, "maps", "m.bsp"), "utf8")).toThrow();
  });

  it("does not copy a file onto itself, and does not delete it on restore", () => {
    const gameDir = tempDir();
    const maps = join(gameDir, "maps");
    mkdirSync(maps, { recursive: true });
    const same = join(maps, "m.bsp");
    writeFileSync(same, "in-place");
    const staged = stageMapPair({ gameDir, map: "m", bsp: same });
    expect(staged.bspInstalled).toBe(false);
    staged.restore();
    expect(readFileSync(same, "utf8")).toBe("in-place");
  });
});

describe("hideFiles", () => {
  it("moves an archive aside and puts it back", () => {
    const dir = tempDir();
    const vpk = join(dir, "campaign.vpk");
    writeFileSync(vpk, "archive");
    const hidden = hideFiles([vpk]);
    expect(hidden).toHaveLength(1);
    expect(() => readFileSync(vpk, "utf8")).toThrow();
    restoreFiles(hidden);
    expect(readFileSync(vpk, "utf8")).toBe("archive");
  });

  it("is idempotent across a stale .off from a crashed run", () => {
    const dir = tempDir();
    const vpk = join(dir, "campaign.vpk");
    writeFileSync(vpk, "archive");
    writeFileSync(`${vpk}.off`, "stale");
    const hidden = hideFiles([vpk]);
    expect(hidden).toHaveLength(1);
    restoreFiles(hidden);
    expect(readFileSync(vpk, "utf8")).toBe("archive");
  });
});
