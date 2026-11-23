import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { checkVtfTool } from "../../src/textures/typescript/tools/vtfcheck.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-vtfcheck-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const DXT1 = 13;
const DXT5 = 15;
const NOMIP = 0x0100;
const ONEBITALPHA = 0x1000;
const ENVMAP = 0x4000;

function header(options: {
  width?: number;
  height?: number;
  flags?: number;
  format?: number;
  frames?: number;
  mipmaps?: number;
}): Buffer {
  const bytes = Buffer.alloc(80);
  bytes.write("VTF\0", 0, "latin1");
  bytes.writeUInt32LE(7, 4);
  bytes.writeUInt32LE(4, 8);
  bytes.writeUInt32LE(80, 12);
  bytes.writeUInt16LE(options.width ?? 512, 16);
  bytes.writeUInt16LE(options.height ?? 512, 18);
  bytes.writeUInt32LE(options.flags ?? 0, 20);
  bytes.writeUInt16LE(options.frames ?? 1, 24);
  bytes.writeInt32LE(options.format ?? DXT1, 52);
  bytes.writeUInt8(options.mipmaps ?? 10, 56);
  return bytes;
}

async function check(name: string, bytes: Buffer) {
  const path = join(scratch, `${name}.vtf`);
  writeFileSync(path, bytes);
  return (await checkVtfTool.handler({ path } as never, ctx)) as unknown as {
    overall: string;
    findings: Array<{ severity: string; rule: string }>;
    header: { mipmaps: number; format: string };
  };
}

describe("check_vtf", () => {
  it("passes a clean DXT1 texture", async () => {
    const result = await check("clean", header({}));
    expect(result.overall).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.header.format).toBe("DXT1");
    expect(result.header.mipmaps).toBe(10);
  });

  it("reports NOMIP with mip levels, the shipped Valve bug", async () => {
    const result = await check("nomip", header({ flags: NOMIP }));
    expect(result.findings.some((finding) => finding.rule === "vtf-nomip-with-mips")).toBe(true);
  });

  it("reports a non-power-of-two size and an oversized texture", async () => {
    const odd = await check("odd", header({ width: 300, height: 300 }));
    expect(odd.findings.some((finding) => finding.rule === "vtf-not-power-of-two")).toBe(true);
    const huge = await check("huge", header({ width: 8192, height: 8192 }));
    expect(huge.findings.some((finding) => finding.rule === "vtf-oversize")).toBe(true);
  });

  it("reports one-bit alpha on a format that cannot store it", async () => {
    const result = await check("alpha", header({ format: DXT5, flags: ONEBITALPHA }));
    expect(
      result.findings.some((finding) => finding.rule === "vtf-onebit-alpha-format"),
    ).toBe(true);
  });

  it("reports an animated, non-square cubemap", async () => {
    const result = await check("cube", header({ flags: ENVMAP, width: 512, height: 256, frames: 2 }));
    const rules = result.findings.map((finding) => finding.rule);
    expect(rules).toContain("vtf-cubemap-not-square");
    expect(rules).toContain("vtf-animated-cubemap");
  });
});
