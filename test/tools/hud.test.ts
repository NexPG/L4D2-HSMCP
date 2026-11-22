/**
 * HUD `.res` files: conditions are data, not a platform decision.
 *
 * The reader must show a `[$X360]` control even on Windows, and the writer must change one
 * value without reformatting the file or dropping a condition. The fixtures use both
 * placements: a condition after a block name and after a value.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readHudTool, writeHudTool } from "../../src/textures/typescript/tools/hud.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const readHud = async (args: Record<string, unknown>) => readHudTool.handler(args as never, ctx);
const writeHud = async (args: Record<string, unknown>) => writeHudTool.handler(args as never, ctx);
const made: string[] = [];
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hsmcp-hud-"));
  made.push(dir);
  const path = join(dir, "hud.res");
  writeFileSync(path, source, "utf8");
  return path;
}

const SOURCE = [
  '"Resource/UI/HudTest.res"',
  "{",
  '\t"HudTest"',
  "\t{",
  '\t\t"ControlName"\t\t"EditablePanel"',
  '\t\t"fieldName"\t\t"HudTest"',
  '\t\t"xpos"\t\t\t"0"',
  "",
  '\t\t// the platform split: this control is Windows only',
  '\t\t"Child" [$WIN32]',
  "\t\t{",
  '\t\t\t"ControlName"\t"Label"',
  '\t\t\t"fieldName"\t\t"Child"',
  '\t\t\t"xpos"\t\t\t"c-10"',
  '\t\t\t"visible"\t\t"1" [!$OSX]',
  '\t\t\t"visible"\t\t"0" [$OSX]',
  "\t\t}",
  '\t\t"Other"',
  "\t\t{",
  '\t\t\t"ControlName"\t"ImagePanel"',
  '\t\t\t"fieldName"\t\t"Other"',
  '\t\t\t"xpos"\t\t\t"10"',
  "\t\t}",
  "\t}",
  "}",
  "",
].join("\n");

type HudControlReply = {
  path: string;
  controlName: string | null;
  fieldName: string | null;
  condition: string | null;
  xpos: string | null;
  tall: string | null;
  values: Array<{ key: string; value: string; condition: string | null }>;
};

type HudReadReply = {
  root: string;
  controlCount: number;
  maxDepth: number;
  returned: number;
  truncated: boolean;
  controls: HudControlReply[];
};

describe("read_hud", () => {
  it("lists the control tree with geometry and both condition placements", async () => {
    const path = scratch(SOURCE);
    const r = (await readHud({ path })) as HudReadReply;

    expect(r.root).toBe("Resource/UI/HudTest.res");
    expect(r.controlCount).toBe(3);
    expect(r.maxDepth).toBe(2);
    expect(r.controls.map((control) => control.path)).toEqual([
      "HudTest",
      "HudTest/Child",
      "HudTest/Other",
    ]);

    const child = r.controls[1]!;
    expect(child.controlName).toBe("Label");
    expect(child.fieldName).toBe("Child");
    expect(child.condition).toBe("[$WIN32]");
    expect(child.xpos).toBe("c-10");
    const visible = child.values.filter((value) => value.key === "visible");
    expect(visible).toEqual([
      { key: "visible", value: "1", condition: "[!$OSX]" },
      { key: "visible", value: "0", condition: "[$OSX]" },
    ]);
  });

  it("searches values and truncates without lying about the count", async () => {
    const path = scratch(SOURCE);
    const byValue = (await readHud({ path, search: "c-10" })) as HudReadReply;
    expect(byValue.returned).toBe(1);
    expect(byValue.controls[0]!.path).toBe("HudTest/Child");

    const limited = (await readHud({ path, limit: 1 })) as HudReadReply;
    expect(limited.returned).toBe(1);
    expect(limited.truncated).toBe(true);
    expect(limited.controlCount).toBe(3);
  });
});

describe("write_hud", () => {
  it("replaces one value and leaves conditions, comments and layout alone", async () => {
    const path = scratch(SOURCE);
    const r = (await writeHud(
      {
        path,
        edits: [{ control: "HudTest/Child", key: "xpos", value: "c-20" }],
        backup: true,
      },
    )) as { written: boolean; backupPath: string | null; edits: unknown[]; verified: boolean };

    expect(r.written).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.backupPath).not.toBeNull();
    const text = readFileSync(path, "utf8");
    expect(text).toContain('"xpos"\t\t\t"c-20"');
    expect(text).toContain('"Child" [$WIN32]');
    expect(text).toContain('"visible"\t\t"1" [!$OSX]');
    expect(text).toContain("// the platform split: this control is Windows only");
    // Nothing else moved: the file differs by exactly the value characters.
    expect(text.length).toBe(SOURCE.length);
  });

  it("refuses an ambiguous key and edits the conditional one when asked", async () => {
    const path = scratch(SOURCE);
    await expect(
      writeHud(
        { path, edits: [{ control: "HudTest/Child", key: "visible", value: "0" }] },
      ),
    ).rejects.toThrow(/2 "visible" pairs/);

    const r = (await writeHud(
      {
        path,
        edits: [{ control: "Child", key: "visible", value: "1", condition: "$OSX" }],
      },
    )) as { edits: Array<{ condition: string; action: string }> };
    expect(r.edits[0]).toMatchObject({ condition: "[$OSX]", action: "replaced" });
    const text = readFileSync(path, "utf8");
    expect(text).toContain('"visible"\t\t"1" [!$OSX]');
    expect(text).toContain('"visible"\t\t"1" [$OSX]');
  });

  it("adds a missing key inside the control with the control's indentation", async () => {
    const path = scratch(SOURCE);
    const r = (await writeHud(
      { path, edits: [{ control: "Other", key: "tall", value: "48" }] },
    )) as { edits: Array<{ action: string }> };
    expect(r.edits[0]!.action).toBe("added");
    const text = readFileSync(path, "utf8");
    expect(text).toContain('\t\t\t"tall" "48"');
    const back = (await readHud({ path })) as HudReadReply;
    expect(back.controls[2]!.tall).toBe("48");
  });

  it("writes a dry run nowhere and an add-on copy without touching the source", async () => {
    const path = scratch(SOURCE);
    const dry = (await writeHud(
      {
        path,
        edits: [{ control: "Other", key: "wide", value: "20" }],
        dryRun: true,
      },
    )) as { written: boolean; backupPath: string | null };
    expect(dry.written).toBe(false);
    expect(dry.backupPath).toBeNull();
    expect(readFileSync(path, "utf8")).toBe(SOURCE);

    const out = join(dirname(path), "override.res");
    const copied = (await writeHud(
      {
        path,
        out,
        edits: [{ control: "Other", key: "wide", value: "20" }],
      },
    )) as { written: boolean; out: string };
    expect(copied.written).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(SOURCE);
    expect(readFileSync(copied.out, "utf8")).toContain('"wide" "20"');
  });

  it("refuses an unknown control before writing", async () => {
    const path = scratch(SOURCE);
    await expect(
      writeHud(
        { path, edits: [{ control: "Nope", key: "xpos", value: "1" }] },
      ),
    ).rejects.toThrow(/no control named "Nope"/);
    expect(readFileSync(path, "utf8")).toBe(SOURCE);
  });
});
