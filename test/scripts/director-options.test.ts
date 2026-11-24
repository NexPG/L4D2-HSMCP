import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { checkDirectorOptionsTool } from "../../src/scripts/typescript/tools/directoroptions.js";
import { ctx as sharedCtx } from "../support/env.js";
const ctx=sharedCtx as unknown as ToolContext;const d=mkdtempSync(join(tmpdir(),"hammer-options-"));afterAll(()=>rmSync(d,{recursive:true,force:true}));
function nut(name:string,body:string):string{const p=join(d,`${name}.nut`);writeFileSync(p,`printl("x")\nDirectorOptions <-\n{\n${body}\n}\n`);return p;}
describe("check_director_options",()=>{
 it("passes a valid table",async()=>{
  const r=await checkDirectorOptionsTool.handler({path:nut("ok","CommonLimit = 0\nMinSpecials = 0\nMaxSpecials = 2")} as never,ctx) as unknown as {verdict:string;findings:Array<{severity:string}>};
  expect(r.verdict).toBe("pass");expect(r.findings.some(f=>f.severity==="error")).toBe(false);
 });
 it("fails a negative limit, a quoted number and Min above Max",async()=>{
  const r=await checkDirectorOptionsTool.handler({path:nut("bad","TankLimit = -1\nMinSpecials = 3\nMaxSpecials = 2")} as never,ctx) as unknown as {verdict:string;findings:Array<{severity:string;key:string}>};
  expect(r.verdict).toBe("fail");
  expect(r.findings.filter(f=>f.severity==="error").length).toBeGreaterThanOrEqual(2);
 });
});