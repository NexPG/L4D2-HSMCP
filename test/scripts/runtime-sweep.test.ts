import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sweepInterruptedState } from "../../src/scripts/typescript/tools/runtime.js";

const scratch = mkdtempSync(join(tmpdir(), "hsmcp-runtime-sweep-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("sweepInterruptedState", () => {
  it("restores cfg, map and script backups left by a killed run", () => {
    const cfg = join(scratch, "cfg");
    const maps = join(scratch, "maps");
    const vscripts = join(scratch, "scripts", "vscripts");
    for (const dir of [cfg, maps, vscripts]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(cfg, "listenserver.cfg"), "sv_cheats 1\nmap test\n", "utf8");
    writeFileSync(join(cfg, "listenserver.cfg.hsmcp-backup"), "// original\n", "utf8");
    writeFileSync(join(maps, "c1m1_hotel.bsp"), "edited", "utf8");
    writeFileSync(join(maps, "c1m1_hotel.bsp.hsmcp-backup"), "original", "utf8");
    writeFileSync(join(vscripts, "probe.nut"), "new", "utf8");
    writeFileSync(join(vscripts, "probe.nut.hsmcp-backup"), "old", "utf8");

    expect(sweepInterruptedState(scratch)).toBe(3);
    expect(readFileSync(join(cfg, "listenserver.cfg"), "utf8")).toBe("// original\n");
    expect(readFileSync(join(maps, "c1m1_hotel.bsp"), "utf8")).toBe("original");
    expect(readFileSync(join(vscripts, "probe.nut"), "utf8")).toBe("old");
    expect(() => readFileSync(join(cfg, "listenserver.cfg.hsmcp-backup"))).toThrow();
  });
});
