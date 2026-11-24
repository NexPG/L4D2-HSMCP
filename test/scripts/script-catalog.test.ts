import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readScriptCatalogTool } from "../../src/scripts/typescript/tools/scriptcatalog.js";
import { ctx as sharedCtx, has } from "../support/env.js";
const ctx=sharedCtx as unknown as ToolContext;
describe.skipIf(!has.gameContent)("read_script_catalog",()=>{
 it("finds a use-target source and its include",async()=>{
  const r=await readScriptCatalogTool.handler({search:"emergency_ammo",details:true,limit:10} as never,ctx) as unknown as {total:number;entries:Array<{name:string;hasNut:boolean;includes:string[];category:string}>};
  expect(r.total).toBe(1);
  expect(r.entries[0]).toMatchObject({name:"emergency_ammo",hasNut:true,category:"usetargets"});
  expect(r.entries[0]!.includes).toContain("usetargets/base_buildable_target");
 });
 it("counts the usetargets family",async()=>{
  const r=await readScriptCatalogTool.handler({category:"usetargets",limit:1000} as never,ctx) as unknown as {total:number};
  expect(r.total).toBeGreaterThan(10);
 });
});