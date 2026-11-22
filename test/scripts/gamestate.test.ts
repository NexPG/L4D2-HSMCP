import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  restoreGameState,
  scanGameState,
} from "../../src/scripts/typescript/game/state.js";

const scratch = mkdtempSync(join(tmpdir(), "hsmcp-gamestate-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("game state", () => {
  it("reports and restores the leftovers of an interrupted run", () => {
    const cfg = join(scratch, "cfg");
    const maps = join(scratch, "maps");
    const vscripts = join(scratch, "scripts", "vscripts");
    const addons = join(scratch, "addons");
    for (const dir of [cfg, maps, vscripts, addons]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(cfg, "listenserver.cfg"), "sv_cheats 1\nmap hmcp_test\n", "utf8");
    writeFileSync(join(cfg, "listenserver.cfg.hsmcp-backup"), "// blank\n", "utf8");
    writeFileSync(join(maps, "hmcp_probe.bsp"), "test", "utf8");
    writeFileSync(join(maps, "c1m1_hotel.bsp.hsmcp-backup"), "original", "utf8");
    writeFileSync(join(vscripts, "hsmcp_probe.nut"), "script", "utf8");
    writeFileSync(join(addons, "hsmcp_test.vpk.off"), "archive", "utf8");

    const before = scanGameState(scratch);
    expect(before.clean).toBe(false);
    expect(before.listenserverBlank).toBe(false);
    expect(before.restorable).toBe(3);
    expect(before.testMaps).toContain("hmcp_probe.bsp");
    expect(before.testScripts).toContain("hsmcp_probe.nut");
    const rules = before.findings.map((finding) => finding.rule);
    expect(rules).toContain("listenserver-not-blank");
    expect(rules).toContain("state-backup-left");
    expect(rules).toContain("addon-left-hidden");
    expect(rules).toContain("test-map-present");

    expect(restoreGameState(scratch)).toBe(3);
    expect(readFileSync(join(cfg, "listenserver.cfg"), "utf8")).toBe("// blank\n");
    expect(readFileSync(join(maps, "c1m1_hotel.bsp"), "utf8")).toBe("original");
    expect(readFileSync(join(addons, "hsmcp_test.vpk"), "utf8")).toBe("archive");
    // Test content without a backup is reported, never deleted.
    expect(readFileSync(join(maps, "hmcp_probe.bsp"), "utf8")).toBe("test");

    const after = scanGameState(scratch);
    expect(after.listenserverBlank).toBe(true);
    expect(after.backups).toEqual([]);
    expect(after.hiddenArchives).toEqual([]);
  });
});
