import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/registry.js";
import { readFgdClass } from "../../src/tools/vmf.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!has.sidecar || !has.fgd)("read_fgd_class with an extra FGD", () => {
  it("merges a community FGD and tolerates a Hammer++ value type", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hsmcp-fgd-"));
    made.push(dir);
    const fgd = join(dir, "extra.fgd");
    writeFileSync(
      fgd,
      [
        '@PointClass base(Targetname) = hsmcp_test_vector3 : "Test vector3"',
        "[",
        '  vec(vector3) : "Vector" : "0 0 0"',
        "]",
        "",
      ].join("\n"),
      "utf8",
    );
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
});
