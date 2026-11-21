/**
 * The VMF text layer: output separators, Valve conditionals and encoding.
 *
 * These are the details Hammer writes and srctools reads differently. Every case here was
 * reproduced on a real file first; the tests keep the fix from drifting back.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { normalizeVmfIo, readVmf } from "../../src/maps/typescript/tools/vmf.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-vmfio-"));
const ESC = "\u001b";

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const MAP = (output: string): string =>
  [
    "versioninfo",
    "{",
    '\t"editorversion" "400"',
    '\t"editorbuild" "5304"',
    '\t"mapversion" "1"',
    '\t"formatversion" "100"',
    '\t"prefab" "0"',
    "}",
    "visgroups",
    "{",
    "}",
    "world",
    "{",
    '\t"id" "1"',
    '\t"classname" "worldspawn"',
    '\t"message" "a,b,c"',
    "}",
    "entity",
    "{",
    '\t"id" "2"',
    '\t"classname" "func_button"',
    "\tconnections",
    "\t{",
    `\t\t"OnPressed" "${output}"`,
    "\t}",
    "}",
    "",
  ].join("\n");

describe("normalize_vmf_io", () => {
  it("converts legacy comma outputs to ESC and leaves every other comma alone", async () => {
    const path = join(scratch, "comma.vmf");
    writeFileSync(path, MAP("door_a,Open,,0,-1"), "utf8");

    const r = (await normalizeVmfIo.handler(
      { path, to: "esc", backup: false, confirm: true } as never,
      ctx,
    )) as { written: boolean; outputs: number; separators: number; note: string };

    expect(r.written).toBe(true);
    expect(r.outputs).toBe(1);
    expect(r.separators).toBe(4);
    const text = readFileSync(path, "utf8");
    expect(text).toContain(`"OnPressed" "door_a${ESC}Open${ESC}${ESC}0${ESC}-1"`);
    // A worldspawn message is a value, not an output; rewriting it would corrupt the map.
    expect(text).toContain('"message" "a,b,c"');
  });

  it("is a no-op on a file that already uses the target separator", async () => {
    const path = join(scratch, "esc.vmf");
    writeFileSync(path, MAP(`door_a${ESC}Open${ESC}${ESC}0${ESC}-1`), "utf8");

    const r = (await normalizeVmfIo.handler(
      { path, to: "esc", backup: false, confirm: true } as never,
      ctx,
    )) as { written: boolean; outputs: number; note: string };

    expect(r.written).toBe(false);
    expect(r.outputs).toBe(0);
    expect(r.note).toMatch(/already uses the esc separator/);
  });

  it("can also go the other way, from ESC to commas", async () => {
    const path = join(scratch, "roundtrip.vmf");
    writeFileSync(path, MAP(`door_a${ESC}Open${ESC}${ESC}0${ESC}-1`), "utf8");

    const r = (await normalizeVmfIo.handler(
      { path, to: "comma", backup: false, confirm: true } as never,
      ctx,
    )) as { written: boolean; separators: number };

    expect(r.written).toBe(true);
    expect(r.separators).toBe(4);
    expect(readFileSync(path, "utf8")).toContain('"OnPressed" "door_a,Open,,0,-1"');
  });
});

describe.skipIf(!has.sidecar)("read_vmf text handling", () => {
  it("keeps [$WIN32] keys and drops [!$WIN32] ones, like the engine on a PC", async () => {
    const path = join(scratch, "flags.vmf");
    writeFileSync(
      path,
      MAP(`door_a${ESC}Open${ESC}${ESC}0${ESC}-1`).replace(
        '\t"classname" "func_button"',
        [
          '\t"classname" "func_button"',
          '\t"vscripts" "only_pc.nut" [$WIN32]',
          '\t"notpc" "never.nut" [!$WIN32]',
          '\t"quoted" "[$WIN32] is not a flag here"',
        ].join("\n"),
      ),
      "utf8",
    );

    const r = (await readVmf.handler({ path } as never, ctx)) as {
      entities: Array<{ keyvalues: Record<string, string> }>;
    };
    const entity = r.entities.find((entry) => entry.keyvalues.classname === "func_button")!;
    expect(entity.keyvalues.vscripts).toBe("only_pc.nut");
    expect(entity.keyvalues.notpc).toBeUndefined();
    // Only unquoted brackets are conditionals.
    expect(entity.keyvalues.quoted).toBe("[$WIN32] is not a flag here");
  });

  it("decodes a cp1251 map, which is what Hammer writes on a Russian install", async () => {
    const path = join(scratch, "cyrillic.vmf");
    // Node has no cp1251 encoder, and the point is the bytes Hammer would write: the four
    // Cyrillic letters of "цель" map to F6 E5 EB FC.
    const CP1251: Record<string, number> = { ц: 0xf6, е: 0xe5, л: 0xeb, ь: 0xfc };
    const toCp1251 = (value: string): Buffer =>
      Buffer.from(
        Uint8Array.from([...value].map((char) => CP1251[char] ?? char.charCodeAt(0))),
      );
    writeFileSync(
      path,
      toCp1251(
        MAP(`door_a${ESC}Open${ESC}${ESC}0${ESC}-1`).replace(
          '\t"classname" "func_button"',
          '\t"classname" "func_button"\n\t"targetname" "цель"',
        ),
      ),
    );

    const r = (await readVmf.handler({ path } as never, ctx)) as {
      entities: Array<{ targetname: string | null }>;
    };
    expect(r.entities.map((entry) => entry.targetname)).toContain("цель");
  });
});
