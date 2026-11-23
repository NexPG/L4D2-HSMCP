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
    const models = join(scratch, "models", "hsmcp_ct");
    for (const dir of [cfg, maps, vscripts, addons, models]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(models, "car.mdl"), "mdl", "utf8");
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
    expect(before.testModels).toContain("hsmcp_ct");
    const rules = before.findings.map((finding) => finding.rule);
    expect(rules).toContain("listenserver-not-blank");
    expect(rules).toContain("state-backup-left");
    expect(rules).toContain("addon-left-hidden");
    expect(rules).toContain("test-map-present");
    expect(rules).toContain("test-model-present");

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

    // No backup at all: a killed run whose install had no file to copy. The header is the
    // harness's own, so the leftover is blanked rather than left to auto-load a test map.
    writeFileSync(join(cfg, "listenserver.cfg"), "sv_cheats 1\nmap hmcp_test\n", "utf8");
    expect(scanGameState(scratch).restorable).toBe(1);
    expect(restoreGameState(scratch)).toBe(1);
    expect(readFileSync(join(cfg, "listenserver.cfg"), "utf8")).toBe(
      "// PC listenserver cfg file - intentionally blank\n",
    );
    // A file the user wrote is never rewritten, even though it is not blank.
    writeFileSync(join(cfg, "listenserver.cfg"), "hostname my server\n", "utf8");
    expect(restoreGameState(scratch)).toBe(0);
    expect(readFileSync(join(cfg, "listenserver.cfg"), "utf8")).toBe("hostname my server\n");
  });
});
