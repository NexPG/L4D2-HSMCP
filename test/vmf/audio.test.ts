import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { editVmf } from "../../src/maps/typescript/tools/vmfedit.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { readBspEntities } from "../../src/maps/typescript/tools/bsp.js";
import { ctx as sharedCtx, has } from "../support/env.js";
const ctx=sharedCtx as unknown as ToolContext;const scratch=mkdtempSync(join(tmpdir(),"hammer-audio-"));afterAll(()=>rmSync(scratch,{recursive:true,force:true}));
const S='versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n\t"skyname" "sky_l4d_c1_1_hdr"\n}\nentity\n{\n\t"id" "2"\n\t"classname" "info_player_start"\n\t"origin" "0 0 16"\n}\n';
const ROOM=insertSolids(S,[{shape:"box",mins:[-512,-512,-32],maxs:[512,512,0]},{shape:"box",mins:[-512,-512,384],maxs:[512,512,416]},{shape:"box",mins:[-544,-544,-32],maxs:[-512,512,416]},{shape:"box",mins:[512,-544,-32],maxs:[544,512,416]},{shape:"box",mins:[-512,-544,-32],maxs:[512,-512,416]},{shape:"box",mins:[-512,512,-32],maxs:[512,544,416]}],{material:"DEV/DEV_MEASUREGENERIC01"}).text;
describe.skipIf(!has.toolchain)("map audio",()=>{
 it("writes two scapes, a proxy, music and a mix layer",async()=>{
  const path=join(scratch,"audio.vmf");writeFileSync(path,ROOM);
  await editVmf.handler({path,ops:[
   {op:"add",keyvalues:{classname:"env_soundscape",targetname:"scape_out",origin:"0 0 64",soundscape:"SantaMonica.Rain",radius:"-1"}},
   {op:"add",keyvalues:{classname:"env_soundscape",targetname:"scape_in",origin:"0 0 64",soundscape:"SantaMonica.RainInside",radius:"-1"}},
   {op:"add",keyvalues:{classname:"env_soundscape_proxy",targetname:"scape_proxy",origin:"0 0 64",MainSoundscapeName:"scape_out",radius:"512"}},
   {op:"add",keyvalues:{classname:"ambient_music",targetname:"music_cue",origin:"0 0 64",message:"Event.MissionStart"}},
   {op:"add",keyvalues:{classname:"sound_mix_layer",targetname:"mix_rain",origin:"0 0 0",MixLayerName:"rain",Level:"0.5"}},
  ],confirm:true} as never,ctx);
  const c=await runCompile.handler({vmf:path,fast:true,hdr:false,stages:["vbsp"],toolchain:"stock",cull:false,timeoutMinutes:10,confirm:true} as never,ctx) as unknown as {ok:boolean;leaked:boolean;bsp:string};
  expect(c.leaked).toBe(false);expect(c.ok).toBe(true);
  const e=await readBspEntities.handler({path:c.bsp,limit:1,offset:0,histogramOnly:true},ctx) as unknown as {histogram:Record<string,number>};
  expect(e.histogram.env_soundscape??0).toBe(2);
  expect(e.histogram.env_soundscape_proxy??0).toBe(1);
  expect(e.histogram.ambient_music??0).toBe(1);
  expect(e.histogram.sound_mix_layer??0).toBe(1);
 },300000);
});