import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  checkDirectorOptionsTool,
  writeDirectorOptionsTool,
} from "../../src/scripts/typescript/tools/directoroptions.js";
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

describe("write_director_options",()=>{
 it("replaces the table and leaves the rest of the script alone",async()=>{
  const p=join(d,"replace.nut");
  writeFileSync(p,'printl("head")\nDirectorOptions <-\n{\n    CommonLimit = 1\n}\n\nfunction KeepMe(){ return 1 }\n');
  const r=await writeDirectorOptionsTool.handler({path:p,options:{CommonLimit:0,TankLimit:1,EscapeSpawnTanks:false},confirm:true} as never,ctx) as unknown as {verdict:string;replaced:boolean;directorOptions:Record<string,string>};
  const text=readFileSync(p,"utf8");
  expect(r.verdict).toBe("pass");expect(r.replaced).toBe(true);
  expect(text).toContain('printl("head")');expect(text).toContain("function KeepMe");
  expect(text.match(/DirectorOptions/g)?.length).toBe(1);
  expect(r.directorOptions).toMatchObject({CommonLimit:"0",TankLimit:"1",EscapeSpawnTanks:"false"});
 });
 it("adds the table when the script has none",async()=>{
  const p=join(d,"create.nut");writeFileSync(p,'printl("x")\n');
  const r=await writeDirectorOptionsTool.handler({path:p,options:{CommonLimit:2},confirm:true} as never,ctx) as unknown as {created:boolean;replaced:boolean};
  const text=readFileSync(p,"utf8");
  expect(r.created).toBe(false);expect(r.replaced).toBe(false);
  expect(text).toContain("DirectorOptions <-\n{\n    CommonLimit = 2\n}");
 });
 it("creates the .nut when it does not exist",async()=>{
  const p=join(d,"new.nut");
  const r=await writeDirectorOptionsTool.handler({path:p,options:{CommonLimit:1},confirm:true} as never,ctx) as unknown as {created:boolean;replaced:boolean};
  expect(r.created).toBe(true);expect(r.replaced).toBe(false);
  expect(readFileSync(p,"utf8")).toBe("DirectorOptions <-\n{\n    CommonLimit = 1\n}\n");
 });
 it("writes a custom-finale stage type as a Squirrel constant",async()=>{
  const p=join(d,"stage.nut");writeFileSync(p,'printl("x")\n');
  const r=await writeDirectorOptionsTool.handler({path:p,options:{A_CustomFinale_StageCount:1,A_CustomFinale1:"PANIC"},confirm:true} as never,ctx) as unknown as {verdict:string};
  const text=readFileSync(p,"utf8");
  expect(r.verdict).toBe("pass");
  expect(text).toContain("A_CustomFinale1 = PANIC");
  expect(text).not.toContain('A_CustomFinale1 = "PANIC"');
 });
 it("rolls back a table the checker rejects",async()=>{
  const p=join(d,"rollback.nut");const before='DirectorOptions <-\n{\n    TankLimit = 1\n}\n';writeFileSync(p,before);
  expect(()=>writeDirectorOptionsTool.handler({path:p,options:{TankLimit:"many"},confirm:true} as never,ctx)).toThrow(/check_director_options/);
  expect(readFileSync(p,"utf8")).toBe(before);
 });
 it("refuses a key that is not a Squirrel identifier",async()=>{
  const p=join(d,"key.nut");writeFileSync(p,'printl("x")\n');
  expect(()=>writeDirectorOptionsTool.handler({path:p,options:{"Bad-Key":1},confirm:true} as never,ctx)).toThrow(/Squirrel identifier/);
 });
});