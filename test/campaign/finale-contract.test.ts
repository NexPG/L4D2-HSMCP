import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { checkFinaleContractTool } from "../../src/campaigns/typescript/tools/finalecontract.js";
import { ctx as sharedCtx, has, config } from "../support/env.js";
const ctx=sharedCtx as unknown as ToolContext;const scratch=mkdtempSync(join(tmpdir(),"hammer-finale-"));afterAll(()=>rmSync(scratch,{recursive:true,force:true}));
function map(trigger:Record<string,string>,extra=""):string{
 const path=join(scratch,`finale-${Math.random().toString(36).slice(2)}.vmf`);
 writeFileSync(path,'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n'+'entity\n{\n\t"id" "2"\n\t"classname" "trigger_finale"\n'+Object.entries(trigger).map(([k,v])=>`\t"${k}" "${v}"\n`).join('')+'}\n'+extra);
 return path;
}
describe("check_finale_contract",()=>{
 it("passes a custom finale with the map script and warns about the contract",async()=>{
  const r=await checkFinaleContractTool.handler({path:map({type:"2"})} as never,ctx) as unknown as {type:number;verdict:string;warnings:string[];failures:string[]};
  expect(r.type).toBe(2);expect(r.verdict).toBe("pass");expect(r.failures).toEqual([]);expect(r.warnings.join(" ")).toMatch(/finale script/);
 });
 it("fails a scavenge finale with no gas cans",async()=>{
  const r=await checkFinaleContractTool.handler({path:map({type:"4"})} as never,ctx) as unknown as {verdict:string;failures:string[]};
  expect(r.verdict).toBe("fail");expect(r.failures.join(" ")).toMatch(/scavenge/i);
 });
 it.skipIf(!has.gameContent)("passes the official gauntlet",async()=>{
  const p=join(config.gameDir!,"maps","c5m5_bridge.bsp");const n=join(config.gameDir!,"maps","c5m5_bridge.nav");
  const r=await checkFinaleContractTool.handler({path:p,nav:n} as never,ctx) as unknown as {type:number;verdict:string;finaleAreas:number};
  expect(r.type).toBe(1);expect(r.verdict).toBe("pass");expect(r.finaleAreas).toBeGreaterThan(100);
 });
});