import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { editVmf } from "../../src/maps/typescript/tools/vmfedit.js";
import { readItemDensityTool } from "../../src/maps/typescript/tools/itemdensity.js";
import { ctx as sharedCtx, has } from "../support/env.js";
const ctx=sharedCtx as unknown as ToolContext;const scratch=mkdtempSync(join(tmpdir(),"hammer-items-"));afterAll(()=>rmSync(scratch,{recursive:true,force:true}));
const S='versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';
const path=join(scratch,"items.vmf");writeFileSync(path,insertSolids(S,[{shape:"box",mins:[0,0,0],maxs:[64,64,64]}],{material:"BRICK/BRICKWALL001A"}).text);
describe("read_item_density",()=>{
 it("counts the random, specific and health layers",async()=>{
  await editVmf.handler({path,ops:[
   {op:"add",keyvalues:{classname:"weapon_item_spawn",origin:"0 0 16"}},
   {op:"add",keyvalues:{classname:"weapon_item_spawn",origin:"16 0 16"}},
   {op:"add",keyvalues:{classname:"weapon_item_spawn",origin:"32 0 16"}},
   {op:"add",keyvalues:{classname:"weapon_rifle_spawn",origin:"48 0 16"}},
   {op:"add",keyvalues:{classname:"weapon_first_aid_kit_spawn",origin:"64 0 16"}},
   {op:"add",keyvalues:{classname:"weapon_first_aid_kit_spawn",origin:"80 0 16"}},
  ],confirm:true} as never,ctx);
  const r=await readItemDensityTool.handler({path} as never,ctx) as unknown as {total:number;counts:Record<string,number>;categories:Record<string,number>;budget:{status:string}};
  expect(r.total).toBe(6);
  expect(r.counts.weapon_item_spawn).toBe(3);
  expect(r.categories.random).toBe(3);
  expect(r.categories.health).toBe(2);
  expect(r.categories.specific).toBe(1);
  expect(r.budget.status).toBe("sparse");
 });
 it.skipIf(!has.gameContent)("compares with an official full chapter",async()=>{
  const r=await readItemDensityTool.handler({path,peer:"c2m1_highway"} as never,ctx) as unknown as {peer:{total:number}|null};
  expect(r.peer?.total??0).toBeGreaterThan(50);
 });
});