import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { installAddonTool, scaffoldAddonTool } from "../../src/packages/typescript/tools/addon.js";
import { writeDetailSpritesTool } from "../../src/maps/typescript/tools/detail.js";
import { writeMissionPosterTool } from "../../src/campaigns/typescript/tools/poster.js";
import { parse } from "../../src/formats/typescript/kv/parse.js";
import { ctx as sharedCtx } from "../support/env.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-pipeline-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const path = (name: string) => join(scratch, name);

describe("addon scaffold and install", () => {
  it("creates addoninfo and mapspawn, then installs the folder into a fake addons tree", async () => {
    const dir = path("my-addon");
    const scaffold = (await scaffoldAddonTool.handler(
      { path: dir, title: "My Addon", author: "Tester", confirm: true } as never,
      ctx,
    )) as unknown as { addoninfo: string; mapspawn: string };
    expect(readFileSync(scaffold.addoninfo, "utf8")).toContain("addonAICredit");
    expect(readFileSync(scaffold.mapspawn, "utf8")).toContain("mapspawn loaded");

    const game = path("game");
    mkdirSync(join(game, "left4dead2"), { recursive: true });
    const cfg = Object.create(ctx.config) as Record<string, unknown>;
    Object.defineProperty(cfg, "gameDir", { value: join(game, "left4dead2") });
    const local = { ...ctx, config: cfg } as unknown as ToolContext;
    const installed = (await installAddonTool.handler(
      { path: dir, confirm: true } as never,
      local,
    )) as unknown as { installedPath: string; kind: string; files: number };
    expect(installed.kind).toBe("folder");
    expect(installed.files).toBeGreaterThanOrEqual(2);
    expect(readFileSync(join(installed.installedPath, "addoninfo.txt"), "utf8")).toContain("My Addon");
  });
});

describe("detail sprites", () => {
  it("adds a named type and keeps it readable", async () => {
    const file = path("detail.vbsp");
    const result = (await writeDetailSpritesTool.handler(
      { path: file, name: "my_grass", density: 800, confirm: true } as never,
      ctx,
    )) as unknown as { types: string[]; written: boolean };
    expect(result.written).toBe(true);
    expect(result.types).toContain("my_grass");
    const text = readFileSync(file, "utf8");
    expect(text).toContain("my_grass");
    expect(text).toContain('"sprite"');
    expect(text).toContain("Group1");
    expect(parse(text)[0]?.kind).toBe("block");
  });
});

describe("mission poster", () => {
  it("adds a poster block without losing modes", async () => {
    const file = path("mission.txt");
    writeFileSync(
      file,
      '"mission"\n{\n\t"Name"\t"Test"\n\t"modes"\n\t{\n\t\t"coop"\n\t\t{\n\t\t\t"1"\n\t\t\t{\n\t\t\t\t"Map"\t"m1"\n\t\t\t}\n\t\t}\n\t}\n}\n',
    );
    const result = (await writeMissionPosterTool.handler(
      { path: file, image: "LoadingScreen_Test", widescreen: "LoadingScreen_Test_wide", confirm: true } as never,
      ctx,
    )) as unknown as { written: boolean };
    expect(result.written).toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text).toContain('"poster"');
    expect(text).toContain("LoadingScreen_Test");
    expect(text).toContain("LoadingScreen_Test_wide");
    expect(text).toContain('"modes"');
  });
});
