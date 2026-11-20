import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { writeContentManifestTool } from "../../src/packages/typescript/tools/manifests.js";
import { writeLocalizationTool } from "../../src/assets/typescript/tools/localization.js";
import { writeWorkshopVdfTool } from "../../src/packages/typescript/tools/workshop.js";
import { validateAddonTool } from "../../src/packages/typescript/tools/addoncheck.js";
import { parse } from "../../src/formats/typescript/kv/parse.js";
import { ctx as sharedCtx } from "../support/env.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-manifest-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const text = (path: string) => readFileSync(path, "utf8");

describe("write_content_manifest", () => {
  it("creates a particles manifest, normalizes paths and skips a duplicate", async () => {
    const path = join(scratch, "particles_manifest.txt");
    const first = (await writeContentManifestTool.handler(
      { path, kind: "particles", add: ["my_fx.pcf", "particles/other.pcf"], confirm: true } as never,
      ctx,
    )) as unknown as { added: string[]; written: boolean; block: string };
    expect(first.written).toBe(true);
    expect(first.block).toBe("particles_manifest");
    expect(first.added).toEqual(["particles/my_fx.pcf", "particles/other.pcf"]);
    expect(text(path)).toContain('"file"\t\t"particles/my_fx.pcf"');

    const again = (await writeContentManifestTool.handler(
      { path, kind: "particles", add: ["particles/my_fx.pcf"], confirm: true } as never,
      ctx,
    )) as unknown as { added: string[]; skipped: string[]; written: boolean };
    expect(again.added).toEqual([]);
    expect(again.skipped).toEqual(["particles/my_fx.pcf"]);
    expect(again.written).toBe(false);
  });

  it("removes one entry and keeps a comment", async () => {
    const path = join(scratch, "sounds_manifest.txt");
    writeFileSync(path, '// hand-written comment\ngame_sounds_manifest\n{\n\t"precache_file"\t\t"scripts/old.txt"\n}\n');
    const result = (await writeContentManifestTool.handler(
      { path, kind: "sounds", remove: ["scripts/old.txt"], add: ["new.txt"], confirm: true } as never,
      ctx,
    )) as unknown as { removed: string[]; added: string[] };
    expect(result.removed).toHaveLength(1);
    expect(result.added).toEqual(["scripts/new.txt"]);
    expect(text(path)).toContain("// hand-written comment");
    expect(text(path)).not.toContain("scripts/old.txt");
    expect(text(path)).toContain('"precache_file"\t\t"scripts/new.txt"');
  });

  it("writes the soundscapes block with the stock typo", async () => {
    const path = join(scratch, "soundscapes_manifest.txt");
    await writeContentManifestTool.handler(
      { path, kind: "soundscapes", add: ["soundscapes_mine.txt"], confirm: true } as never,
      ctx,
    );
    expect(text(path)).toContain("soundscaples_manifest");
    expect(text(path)).toContain('"file"\t\t"scripts/soundscapes_mine.txt"');
    const nodes = parse(text(path));
    expect(nodes[0]?.kind).toBe("block");
  });
});

describe("write_localization", () => {
  it("writes UTF-16LE with a BOM, then updates and appends a token", async () => {
    const path = join(scratch, "closecaption_english.txt");
    const first = (await writeLocalizationTool.handler(
      {
        path,
        language: "English",
        tokens: { "[english]MyToken": "First", "MySecond": "Second" },
        encoding: "utf16le",
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { added: string[]; written: boolean; encoding: string };
    expect(first.encoding).toBe("utf16le");
    expect(first.added).toEqual(["[english]MyToken", "MySecond"]);
    const bytes = readFileSync(path);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xfe);
    const decoded = bytes.subarray(2).toString("utf16le");
    expect(decoded).toContain('"Language"\t"English"');
    expect(decoded).toContain('"MySecond"\t\t"Second"');

    const second = (await writeLocalizationTool.handler(
      {
        path,
        language: "English",
        tokens: { "[english]MyToken": "Changed", "Third": "3" },
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { updated: string[]; added: string[]; encoding: string };
    expect(second.encoding).toBe("utf16le");
    expect(second.updated).toEqual(["[english]MyToken"]);
    expect(second.added).toEqual(["Third"]);
    const after = readFileSync(path).subarray(2).toString("utf16le");
    expect(after).toContain('"Changed"');
    expect(after).toContain('"Third"\t\t"3"');
  });
});

describe("write_workshop_vdf", () => {
  it("writes the appid, paths and metadata", async () => {
    const dir = join(scratch, "addon");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "addoninfo.txt"), '"addoninfo"\n{\n\t"addonTitle"\t"Test"\n}\n');
    const out = join(scratch, "workshop_build_item.vdf");
    const result = (await writeWorkshopVdfTool.handler(
      {
        contentFolder: dir,
        out,
        title: 'My "Addon"',
        description: "Line one\nLine two",
        publishedFileId: "0",
        visibility: 2,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { written: boolean; warnings: string[] };
    expect(result.written).toBe(true);
    const body = text(out);
    expect(body).toContain('"appid"\t\t"550"');
    expect(body).toContain('"publishedfileid"\t\t"0"');
    expect(body).toContain('"visibility"\t\t"2"');
    expect(body).toContain('My \\"Addon\\"');
    expect(body).toContain("Line one");
  });

  it("warns when the content folder has no addoninfo", async () => {
    const dir = join(scratch, "bare");
    mkdirSync(dir, { recursive: true });
    const result = (await writeWorkshopVdfTool.handler(
      { contentFolder: dir, title: "Bare", confirm: true } as never,
      ctx,
    )) as unknown as { warnings: string[] };
    expect(result.warnings.join(" ")).toContain("addoninfo");
  });
});

describe("validate_addon", () => {
  it("passes a clean addon and warns about a missing manifest file", async () => {
    const dir = join(scratch, "check-clean");
    mkdirSync(join(dir, "scripts", "vscripts"), { recursive: true });
    writeFileSync(
      join(dir, "addoninfo.txt"),
      '"addoninfo"\n{\n\t"addonTitle"\t"Check"\n\t"addonSteamAppID"\t"550"\n}\n',
    );
    writeFileSync(join(dir, "scripts", "vscripts", "clean.nut"), 'printl( "clean" );\n');
    const result = (await validateAddonTool.handler(
      { dir } as never,
      ctx,
    )) as unknown as { overall: string; counts: { error: number; warning: number } };
    expect(result.counts.error).toBe(0);
    expect(result.overall).not.toBe("fail");

    mkdirSync(join(dir, "particles"), { recursive: true });
    writeFileSync(
      join(dir, "particles", "particles_manifest.txt"),
      'particles_manifest\n{\n\t"file"\t"particles/missing.pcf"\n}\n',
    );
    const warned = (await validateAddonTool.handler(
      { dir } as never,
      ctx,
    )) as unknown as { overall: string; findings: Array<{ rule: string }> };
    expect(warned.findings.some((finding) => finding.rule === "manifest-missing-file")).toBe(true);
  });

  it("fails an addon whose script does not parse", async () => {
    const dir = join(scratch, "check-broken");
    mkdirSync(join(dir, "scripts", "vscripts"), { recursive: true });
    writeFileSync(join(dir, "addoninfo.txt"), '"addoninfo"\n{\n\t"addonTitle"\t"Broken"\n}\n');
    writeFileSync(join(dir, "scripts", "vscripts", "broken.nut"), "function f()\n{\n");
    const result = (await validateAddonTool.handler(
      { dir } as never,
      ctx,
    )) as unknown as { overall: string; counts: { error: number } };
    expect(result.counts.error).toBeGreaterThan(0);
    expect(result.overall).toBe("fail");
  });
});
