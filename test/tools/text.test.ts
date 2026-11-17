import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/registry.js";
import { readTextFileTool, writeTextFileTool } from "../../src/tools/text.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-text-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("write_text_file and read_text_file", () => {
  it("writes arbitrary text and reads it back", async () => {
    const path = join(scratch, "model.qc");
    const content = '$modelname "hsmcp_test/model.mdl"\n$body "body" "model.smd"\n';
    const written = (await writeTextFileTool.handler(
      { path, content, overwrite: false, backup: false, confirm: true },
      ctx,
    )) as { written: boolean; bytes: number };
    expect(written.written).toBe(true);
    expect(written.bytes).toBe(Buffer.byteLength(content, "utf8"));

    const read = (await readTextFileTool.handler({ path }, ctx)) as {
      text: string;
      totalLines: number;
      truncated: boolean;
    };
    expect(read.text).toContain('"hsmcp_test/model.mdl"');
    expect(read.totalLines).toBe(2);
    expect(read.truncated).toBe(false);
  });

  it("refuses to replace without overwrite, and honours a dry run", async () => {
    const path = join(scratch, "keep.txt");
    writeFileSync(path, "old", "utf8");
    expect(() =>
      writeTextFileTool.handler(
        { path, content: "new", overwrite: false, backup: false, confirm: true },
        ctx,
      ),
    ).toThrow(/already exists/);

    const dry = (await writeTextFileTool.handler(
      { path, content: "new", overwrite: true, dryRun: true, backup: false, confirm: true },
      ctx,
    )) as { written: boolean; unchanged: boolean };
    expect(dry.written).toBe(false);
    expect(dry.unchanged).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("old");
  });

  it("returns a line window", async () => {
    const path = join(scratch, "lines.txt");
    writeFileSync(path, "a\nb\nc\nd\n", "utf8");
    const read = (await readTextFileTool.handler({ path, startLine: 2, maxLines: 2 }, ctx)) as {
      text: string;
      returned: number;
      truncated: boolean;
    };
    expect(read.text).toBe("b\nc");
    expect(read.returned).toBe(2);
    expect(read.truncated).toBe(true);
  });

  it("refuses binary text", async () => {
    const path = join(scratch, "binary.txt");
    writeFileSync(path, Buffer.from([0x61, 0x00, 0x62]));
    expect(() => readTextFileTool.handler({ path }, ctx)).toThrow(/NUL byte/);
  });
});
