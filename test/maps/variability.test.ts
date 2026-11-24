import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { editVmf } from "../../src/maps/typescript/tools/vmfedit.js";
import { writeRandomCaseTool, writeTemplateSpawnerTool } from "../../src/maps/typescript/tools/variability.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { readBspEntities } from "../../src/maps/typescript/tools/bsp.js";
import { ctx as sharedCtx, has } from "../support/env.js";
const ctx=sharedCtx as unknown as ToolContext;const scratch=mkdtempSync(join(tmpdir(),"hammer-var-"));afterAll(()=>rmSync(scratch,{recursive:true,force:true}));
const S='versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n\t"skyname" "sky_l4d_c1_1_hdr"\n}\nentity\n{\n\t"id" "2"\n\t"classname" "info_player_start"\n\t"origin" "0 0 16"\n}\n';
const ROOM=insertSolids(S,[{shape:"box",mins:[-512,-512,-32],maxs:[512,512,0]},{shape:"box",mins:[-512,-512,384],maxs:[512,512,416]},{shape:"box",mins:[-544,-544,-32],maxs:[-512,512,416]},{shape:"box",mins:[512,-544,-32],maxs:[544,512,416]},{shape:"box",mins:[-512,-544,-32],maxs:[512,-512,416]},{shape:"box",mins:[-512,512,-32],maxs:[512,544,416]}],{material:"DEV/DEV_MEASUREGENERIC01"}).text;
describe.skipIf(!has.toolchain)("variability",()=>{
 it("writes a random case, a template and a maker",async()=>{
  const path=join(scratch,"var.vmf");writeFileSync(path,ROOM);
  await editVmf.handler({path,ops:[
   {op:"add",keyvalues:{classname:"prop_dynamic",targetname:"car_a",origin:"-128 0 16",model:"models/props_vehicles/cara_95sedan.mdl",solid:"6"}},
   {op:"add",keyvalues:{classname:"prop_dynamic",targetname:"car_b",origin:"128 0 16",model:"models/props_vehicles/cara_95sedan.mdl",solid:"6"}},
  ],confirm:true} as never,ctx);
  const r=await writeRandomCaseTool.handler({path,origin:[0,0,64],targetname:"car_color",cases:[{target:"car_a",input:"Color",parameter:"200 30 30"},{target:"car_b",input:"Color",parameter:"30 30 200"}],confirm:true} as never,ctx) as unknown as {caseId:number|null;autoId:number|null};
  expect(r.caseId).not.toBeNull();expect(r.autoId).not.toBeNull();
  const t=await writeTemplateSpawnerTool.handler({path,origin:[0,0,64],targetname:"car_set",templates:["car_a","car_b"],confirm:true} as never,ctx) as unknown as {templateId:number|null;makerId:number|null};
  expect(t.templateId).not.toBeNull();expect(t.makerId).not.toBeNull();
  const c=await runCompile.handler({vmf:path,fast:true,hdr:false,stages:["vbsp"],toolchain:"stock",cull:false,timeoutMinutes:10,confirm:true} as never,ctx) as unknown as {ok:boolean;leaked:boolean;bsp:string};
  expect(c.leaked).toBe(false);expect(c.ok).toBe(true);
  const e=await readBspEntities.handler({path:c.bsp,limit:1,offset:0,histogramOnly:true},ctx) as unknown as {histogram:Record<string,number>};
  expect(e.histogram.logic_case??0).toBe(1);
  expect(e.histogram.point_template??0).toBe(1);
  expect(e.histogram.env_entity_maker??0).toBe(1);
 },300000);
});