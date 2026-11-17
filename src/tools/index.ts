import type { AnyToolDef } from "../mcp/registry.js";
import { bspTools } from "./bsp.js";
import { bspEditTools } from "./bspedit.js";
import { buildCubemapTools } from "./buildcubemaps.js";
import { buildTools } from "./build.js";
import { captureTools } from "./capture.js";
import { campaignTools } from "./campaign.js";
import { addonTools } from "./addon.js";
import { clipTools } from "./clip.js";
import { compileTools } from "./compile.js";
import { contentTools } from "./content.js";
import { cubemapTools } from "./cubemap.js";
import { depsTools } from "./deps.js";
import { displacementTools } from "./displacement.js";
import { exportMapTools } from "./exportmap.js";
import { faceTools } from "./face.js";
import { gameTools } from "./games.js";
import { healthTools } from "./health.js";
import { hlmvTools } from "./hlmv.js";
import { hollowTools } from "./hollow.js";
import { instanceTools } from "./instance.js";
import { instanceCreateTools } from "./instancecreate.js";
import { lightmapTools } from "./lightmap.js";
import { materialsTools } from "./materials.js";
import { measureTools } from "./measure.js";
import { measureTools2 } from "./measurespace.js";
import { mergeTools } from "./merge.js";
import { modifyTools } from "./modify.js";
import { optimiseTools } from "./optimise.js";
import { organiseTools } from "./organise.js";
import { overlayTools } from "./overlay.js";
import { pakfileTools } from "./pakfile.js";
import { planTools } from "./plan.js";
import { prefabTools } from "./prefab.js";
import { renameTools } from "./rename.js";
import { renderTools } from "./render.js";
import { reportTools } from "./report.js";
import { rulesTools } from "./rules.js";
import { runtimeTools } from "./runtime.js";
import { sceneTools } from "./scene.js";
import { skyboxTools } from "./skybox.js";
import { skyboxCopyTools } from "./skyboxcopy.js";
import { snapTools } from "./snap.js";
import { solidTools } from "./solids.js";
import { spaceTools } from "./space.js";
import { studiomdlTools } from "./studiomdl.js";
import { textTools } from "./text.js";
import { vertexTools } from "./vertex.js";
import { visleafTools } from "./visleaf.js";
import { vtfTools } from "./vtf.js";
import { vmfTools } from "./vmf.js";
import { vmfEditTools } from "./vmfedit.js";
import { vscriptTools } from "./vscript.js";
import { wiringTools } from "./wiring.js";
import { weatherTools } from "./weather.js";
import { worldspawnTools } from "./worldspawn.js";

export const allTools: AnyToolDef[] = [
  ...healthTools,
  ...hlmvTools,
  ...gameTools,
  ...campaignTools,
  ...addonTools,
  ...bspTools,
  ...bspEditTools,
  ...buildCubemapTools,
  ...captureTools,
  ...measureTools,
  ...materialsTools,
  ...lightmapTools,
  ...visleafTools,
  ...reportTools,
  ...vmfTools,
  ...contentTools,
  ...solidTools,
  ...spaceTools,
  ...sceneTools,
  ...measureTools2,
  ...rulesTools,
  ...renderTools,
  ...planTools,
  ...prefabTools,
  ...displacementTools,
  ...exportMapTools,
  ...buildTools,
  ...modifyTools,
  ...mergeTools,
  ...snapTools,
  ...instanceCreateTools,
  ...clipTools,
  ...vertexTools,
  ...hollowTools,
  ...faceTools,
  ...organiseTools,
  ...optimiseTools,
  ...depsTools,
  ...wiringTools,
  ...vmfEditTools,
  ...compileTools,
  ...renameTools,
  ...cubemapTools,
  ...pakfileTools,
  ...vtfTools,
  ...runtimeTools,
  ...vscriptTools,
  ...overlayTools,
  ...instanceTools,
  ...skyboxTools,
  ...skyboxCopyTools,
  ...weatherTools,
  ...worldspawnTools,
  ...textTools,
  ...studiomdlTools,
];
