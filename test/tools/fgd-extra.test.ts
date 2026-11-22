import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readFgdAutovisgroups, readFgdClass } from "../../src/maps/typescript/tools/vmf.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function extraFgd(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "hsmcp-fgd-"));
  made.push(dir);
  const path = join(dir, "extra.fgd");
  writeFileSync(path, lines.join("\n"), "utf8");
  return path;
}

describe.skipIf(!has.sidecar || !has.fgd)("read_fgd_class with an extra FGD", () => {
  it("merges a community FGD and tolerates a Hammer++ value type", async () => {
    const fgd = extraFgd([
      '@PointClass base(Targetname) = hsmcp_test_vector3 : "Test vector3"',
      "[",
      '  vec(vector3) : "Vector" : "0 0 0"',
      "]",
      "",
    ]);
    const r = (await readFgdClass.handler(
      { classname: "hsmcp_test_vector3", fgd, game: undefined, limit: 200 },
      ctx,
    )) as {
      classCount: number;
      classname: string;
      keyvalues: Array<{ name: string; type: string }>;
    };
    expect(r.classname).toBe("hsmcp_test_vector3");
    expect(r.classCount).toBeGreaterThan(400);
    expect(r.keyvalues.some((kv) => kv.name === "vec")).toBe(true);
  });

  it("searches names, descriptions, keyvalues and I/O", async () => {
    const fgd = extraFgd([
      '@PointClass base(Targetname) = hsmcp_search_target : "A searchable target"',
      "[",
      '  string(markername) : "Marker" : ""',
      "  input Toggle(void) : \"Switch it\"",
      "]",
      "",
    ]);
    const byName = (await readFgdClass.handler(
      { search: "hsmcp_search", fgd, limit: 20 },
      ctx,
    )) as { classnames: string[]; matched: number; search: string };
    expect(byName.search).toBe("hsmcp_search");
    expect(byName.classnames).toContain("hsmcp_search_target");
    expect(byName.matched).toBeGreaterThan(0);

    const byInput = (await readFgdClass.handler(
      { search: "toggle", fgd, limit: 1000 },
      ctx,
    )) as { classnames: string[] };
    expect(byInput.classnames).toContain("hsmcp_search_target");

    const stock = (await readFgdClass.handler(
      { search: "finale", game: undefined, limit: 50 },
      ctx,
    )) as { classnames: string[] };
    expect(stock.classnames).toContain("trigger_finale");
  });

  it("lists @AutoVisgroup groups and their entities", async () => {
    const fgd = extraFgd([
      '@AutoVisgroup = "HSMCP"',
      "[",
      '  "Test Group"',
      "  [",
      '    "prop_dynamic"',
      '    "info_target"',
      "  ]",
      "]",
      "",
    ]);
    const r = (await readFgdAutovisgroups.handler({ fgd, limit: 50 }, ctx)) as {
      groupCount: number;
      groups: Array<{ name: string; parent: string | null; entities: string[] }>;
    };
    expect(r.groupCount).toBe(1);
    expect(r.groups[0]!.name).toBe("Test Group");
    expect(r.groups[0]!.parent).toBe("HSMCP");
    expect(r.groups[0]!.entities).toEqual(["info_target", "prop_dynamic"]);
  });
});
