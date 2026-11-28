import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { writeAddonWorkspaceTool } from "../../src/core/typescript/tools/workspace.js";
import { MapPlanSchema, checkMapPlan } from "../../src/plan/typescript/tools/mapplan.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const name = `workspace-test-${Date.now()}`;
const vname = `${name}-vscript`;
let root = "";
let vroot = "";

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  if (vroot) rmSync(vroot, { recursive: true, force: true });
});

describe("write_addon_workspace", () => {
  it("creates the plan, templates, logs, source, staging, dist and evidence folders", async () => {
    const r = (await writeAddonWorkspaceTool.handler(
      {
        name,
        title: "Test Addon",
        kind: "campaign",
        author: "Tester",
        overwrite: false,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { path: string; created: string[]; skipped: string[]; note: string };
    root = r.path;
    expect(r.path).toMatch(/workspaces[\\/]workspace-test-/);
    for (const relative of [
      "plan/DESIGN.md",
      "plan/ASSETS.md",
      "plan/plan.example.json",
      "templates/addoninfo.txt",
      "templates/mission.txt",
      "reference/README.md",
      "logs/errors.md",
      "README.md",
    ]) {
      expect(existsSync(join(root, relative)), relative).toBe(true);
      expect(r.created).toContain(relative);
    }
    expect(existsSync(join(root, "src"))).toBe(true);
    expect(existsSync(join(root, "addon"))).toBe(true);
    expect(existsSync(join(root, "dist"))).toBe(true);
    expect(existsSync(join(root, "evidence"))).toBe(true);
    expect(existsSync(join(root, "reference"))).toBe(true);

    const design = readFileSync(join(root, "plan", "DESIGN.md"), "utf8");
    expect(design).toContain("# Test Addon — design");
    expect(design).toContain("Status: draft");
    const addoninfo = readFileSync(join(root, "templates", "addoninfo.txt"), "utf8");
    expect(addoninfo).toContain('"addonSteamAppID"\t\t"550"');
    expect(addoninfo).toContain('"addonContent_Campaign"\t\t"1"');
    expect(addoninfo).toContain('"Tester"');

    const example = JSON.parse(readFileSync(join(root, "plan", "plan.example.json"), "utf8"));
    const parsed = MapPlanSchema.parse(example);
    expect(checkMapPlan("example", parsed).ok).toBe(true);
  });

  it("gives a script addon a design note, a reference baseline and the script content flag", async () => {
    const authoredCtx = {
      ...sharedCtx,
      config: { ...sharedCtx.config, addonAuthor: "Stored Author" },
    } as unknown as ToolContext;
    const r = (await writeAddonWorkspaceTool.handler(
      {
        name: vname,
        title: "Script Test",
        kind: "vscript",
        overwrite: false,
        confirm: true,
      } as never,
      authoredCtx,
    )) as unknown as { path: string; created: string[]; note: string };
    vroot = r.path;
    expect(existsSync(join(vroot, "plan"))).toBe(false);
    expect(existsSync(join(vroot, "DESIGN.md"))).toBe(true);
    expect(existsSync(join(vroot, "reference", "README.md"))).toBe(true);
    expect(r.created).not.toContain("plan/DESIGN.md");
    const addoninfo = readFileSync(join(vroot, "templates", "addoninfo.txt"), "utf8");
    expect(addoninfo).toContain('"addonContent_Script"\t\t"1"');
    expect(addoninfo).toContain('"Stored Author"');
    expect(r.note).toContain("no map plan");
  });

  it("refuses a non-empty workspace without overwrite, and fills only missing files with it", async () => {
    expect(() =>
      writeAddonWorkspaceTool.handler(
        { name, kind: "campaign", overwrite: false, confirm: true } as never,
        ctx,
      ),
    ).toThrow(/already exists/);

    const r = (await writeAddonWorkspaceTool.handler(
      { name, kind: "campaign", overwrite: true, confirm: true } as never,
      ctx,
    )) as unknown as { skipped: string[]; created: string[] };
    expect(r.skipped).toContain("plan/DESIGN.md");
    expect(r.skipped).toContain("templates/addoninfo.txt");
    expect(r.created).toEqual([]);
  });

  it("refuses an invalid directory name at the schema", () => {
    const schema = z.object(writeAddonWorkspaceTool.inputSchema);
    expect(() => schema.parse({ name: "Bad Name", confirm: true })).toThrow();
    expect(() => schema.parse({ name: "ok-name", confirm: true })).not.toThrow();
  });
});
