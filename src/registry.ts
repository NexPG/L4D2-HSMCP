import type { AnyToolDef } from "./core/typescript/mcp/registry.js";
import { soundscapeTools } from "./audio/typescript/tools/soundscapes.js";
import { soundscriptTools } from "./audio/typescript/tools/soundscripts.js";
import { wavTools } from "./audio/typescript/tools/wav.js";
import { bspTools } from "./maps/typescript/tools/bsp.js";
import { bspEditTools } from "./maps/typescript/tools/bspedit.js";
import { bspLumpTools } from "./maps/typescript/tools/bsplump.js";
import { staticPropTools } from "./maps/typescript/tools/staticprops.js";
import { buildCubemapTools } from "./textures/typescript/tools/buildcubemaps.js";
import { buildTools } from "./maps/typescript/tools/build.js";
import { captureTools } from "./hammer/typescript/tools/capture.js";
import { campaignTools } from "./campaigns/typescript/tools/campaign.js";
import { campaignBuildTools } from "./campaigns/typescript/tools/campaignbuild.js";
import { gameplayTools } from "./campaigns/typescript/tools/gameplay.js";
import { checkModeTools } from "./campaigns/typescript/tools/modes.js";
import { addonTools } from "./packages/typescript/tools/addon.js";
import { addonCheckTools } from "./packages/typescript/tools/addoncheck.js";
import { manifestTools } from "./packages/typescript/tools/manifests.js";
import { workshopTools } from "./packages/typescript/tools/workshop.js";
import { localizationTools } from "./assets/typescript/tools/localization.js";
import { autosaveTools } from "./maps/typescript/tools/autosave.js";
import { clipTools } from "./maps/typescript/tools/clip.js";
import { compileTools } from "./maps/typescript/tools/compile.js";
import { contentTools } from "./assets/typescript/tools/content.js";
import { surfacePropsTools } from "./assets/typescript/tools/surfaceprops.js";
import { particleTools } from "./assets/typescript/tools/particles.js";
import { cubemapTools } from "./textures/typescript/tools/cubemap.js";
import { cubemapGridTools } from "./maps/typescript/tools/cubemapgrid.js";
import { loadingScreenTools } from "./textures/typescript/tools/loadingscreen.js";
import { vmtCheckTools } from "./textures/typescript/tools/vmtcheck.js";
import { soundCheckTools } from "./audio/typescript/tools/soundcheck.js";
import { depsTools } from "./maps/typescript/tools/deps.js";
import { dmxTools } from "./formats/typescript/tools/dmx.js";
import { dmxSmdTools } from "./models/typescript/tools/dmxsmd.js";
import { gltfTools } from "./models/typescript/tools/gltf.js";
import { gltfDmxTools } from "./models/typescript/tools/gltfdmx.js";
import { brushTools } from "./models/typescript/tools/brush.js";
import { displacementTools } from "./maps/typescript/tools/displacement.js";
import { reviewTools } from "./maps/typescript/tools/review.js";
import { diffTools } from "./maps/typescript/tools/diff.js";
import { detailTools } from "./maps/typescript/tools/detail.js";
import { posterTools } from "./campaigns/typescript/tools/poster.js";
import { particleCheckTools } from "./assets/typescript/tools/particlecheck.js";
import { dressingTools } from "./maps/typescript/tools/dressing.js";
import { entityFamilyTools } from "./maps/typescript/tools/entityfamilies.js";
import { entityProbeTools } from "./maps/typescript/tools/entityprobe.js";
import { navAttributeTools } from "./maps/typescript/tools/navattrs.js";
import { classProbeTools } from "./scripts/typescript/tools/classprobe.js";
import { navProbeTools } from "./scripts/typescript/tools/navprobe.js";
import { entityExtraTools } from "./maps/typescript/tools/entityextras.js";
import { doorTools } from "./maps/typescript/tools/door.js";
import { exportMapTools } from "./maps/typescript/tools/exportmap.js";
import { faceTools } from "./maps/typescript/tools/face.js";
import { finaleTools } from "./campaigns/typescript/tools/finale.js";
import { gameTools } from "./core/typescript/tools/games.js";
import { gateTools } from "./campaigns/typescript/tools/gate.js";
import { hammerTools } from "./hammer/typescript/tools/hammer.js";
import { hammerLiveTools } from "./hammer/typescript/tools/hammerlive.js";
import { windowTools } from "./hammer/typescript/tools/windows.js";
import { hammerPlusPlusTools } from "./hammer/typescript/tools/hammerpp.js";
import { healthTools } from "./core/typescript/tools/health.js";
import { hlmvTools } from "./hammer/typescript/tools/hlmv.js";
import { inputTools } from "./hammer/typescript/tools/input.js";
import { hollowTools } from "./maps/typescript/tools/hollow.js";
import { assetCheckTools } from "./maps/typescript/tools/assets.js";
import { carveTools } from "./maps/typescript/tools/carve.js";
import { hullTools } from "./maps/typescript/tools/hull.js";
import { instanceTools } from "./maps/typescript/tools/instance.js";
import { instanceCreateTools } from "./maps/typescript/tools/instancecreate.js";
import { instanceCollapseTools } from "./maps/typescript/tools/instancecollapse.js";
import { lightmapTools } from "./maps/typescript/tools/lightmap.js";
import { lightmapReadTools } from "./maps/typescript/tools/lightmaps.js";
import { materialsTools } from "./textures/typescript/tools/materials.js";
import { measureTools } from "./maps/typescript/tools/measure.js";
import { measureTools2 } from "./maps/typescript/tools/measurespace.js";
import { mergeTools } from "./maps/typescript/tools/merge.js";
import { modifyTools } from "./maps/typescript/tools/modify.js";
import { navAreasTools } from "./nav/typescript/tools/navareas.js";
import { navPathTools } from "./nav/typescript/tools/navpath.js";
import { navDetailsTools } from "./nav/typescript/tools/navdetails.js";
import { navConnectionTools } from "./nav/typescript/tools/navconnections.js";
import { navTroubleTools } from "./nav/typescript/tools/navtrouble.js";
import { optimiseTools } from "./maps/typescript/tools/optimise.js";
import { organiseTools } from "./maps/typescript/tools/organise.js";
import { overlayTools } from "./maps/typescript/tools/overlay.js";
import { overlayReadTools } from "./maps/typescript/tools/overlays.js";
import { pakfileAddTools } from "./maps/typescript/tools/pakfileadd.js";
import { pakfileTools } from "./packages/typescript/tools/pakfile.js";
import { planTools } from "./maps/typescript/tools/plan.js";
import { prefabTools } from "./maps/typescript/tools/prefab.js";
import { qcTools } from "./models/typescript/tools/qc.js";
import { modelCheckTools } from "./models/typescript/tools/check.js";
import { modelCollisionTools } from "./models/typescript/tools/collision.js";
import { decompileModelTools } from "./models/typescript/tools/decompile.js";
import { modelAnimationTools } from "./models/typescript/tools/animation.js";
import { modelSkeletonTools } from "./models/typescript/tools/skeleton.js";
import { vtaTools } from "./models/typescript/tools/vta.js";
import { modelEyesTools } from "./models/typescript/tools/eyes.js";
import { modelJiggleTools } from "./models/typescript/tools/jiggle.js";
import { modelProceduralTools } from "./models/typescript/tools/procedural.js";
import { modelLodTools } from "./models/typescript/tools/lods.js";
import { modelAniTools } from "./models/typescript/tools/ani.js";
import { modelFlexTools } from "./models/typescript/tools/flexes.js";
import { previewModelTools } from "./models/typescript/tools/preview.js";
import { fbxTools } from "./models/typescript/tools/fbx.js";
import { sequencesTools } from "./maps/typescript/tools/sequences.js";
import { previewTools } from "./assets/typescript/tools/preview.js";
import { renameTools } from "./maps/typescript/tools/rename.js";
import { renderTools } from "./maps/typescript/tools/render.js";
import { renderBspTools } from "./maps/typescript/tools/renderbsp.js";
import { reportTools } from "./maps/typescript/tools/report.js";
import { rulesTools } from "./maps/typescript/tools/rules.js";
import { runtimeTools } from "./scripts/typescript/tools/runtime.js";
import { sceneTools } from "./scripts/typescript/tools/scene.js";
import { skyboxTools } from "./textures/typescript/tools/skybox.js";
import { skyboxCopyTools } from "./textures/typescript/tools/skyboxcopy.js";
import { skyboxBuildTools } from "./textures/typescript/tools/skyboxbuild.js";
import { smdTools } from "./models/typescript/tools/smd.js";
import { snapTools } from "./maps/typescript/tools/snap.js";
import { solidTools } from "./maps/typescript/tools/solids.js";
import { spaceTools } from "./maps/typescript/tools/space.js";
import { studiomdlTools } from "./models/typescript/tools/studiomdl.js";
import { textTools } from "./core/typescript/tools/text.js";
import { terrainTools } from "./maps/typescript/tools/terrain.js";
import { vertexTools } from "./maps/typescript/tools/vertex.js";
import { visleafTools } from "./maps/typescript/tools/visleaf.js";
import { visTools } from "./maps/typescript/tools/vis.js";
import { vtfConvertTools } from "./textures/typescript/tools/vtfconvert.js";
import { vtfGenTools } from "./textures/typescript/tools/vtfgen.js";
import { vtfTools } from "./textures/typescript/tools/vtf.js";
import { vpkTools } from "./packages/typescript/tools/vpk.js";
import { vpkVerifyTools } from "./packages/typescript/tools/vpkverify.js";
import { vmtTools } from "./textures/typescript/tools/vmt.js";
import { rectTools } from "./textures/typescript/tools/rect.js";
import { vmfTools } from "./maps/typescript/tools/vmf.js";
import { vmfEditTools } from "./maps/typescript/tools/vmfedit.js";
import { vscriptTools } from "./scripts/typescript/tools/vscript.js";
import { wiringTools } from "./maps/typescript/tools/wiring.js";
import { waterTools } from "./maps/typescript/tools/water.js";
import { weatherTools } from "./scripts/typescript/tools/weather.js";
import { worldspawnTools } from "./maps/typescript/tools/worldspawn.js";

export const allTools: AnyToolDef[] = [
  ...healthTools,
  ...hammerTools,
  ...hammerLiveTools,
  ...windowTools,
  ...hammerPlusPlusTools,
  ...hlmvTools,
  ...inputTools,
  ...gameTools,
  ...campaignTools,
  ...campaignBuildTools,
  ...gameplayTools,
  ...checkModeTools,
  ...gateTools,
  ...addonTools,
  ...addonCheckTools,
  ...manifestTools,
  ...workshopTools,
  ...localizationTools,
  ...autosaveTools,
  ...bspTools,
  ...bspEditTools,
  ...buildCubemapTools,
  ...captureTools,
  ...measureTools,
  ...materialsTools,
  ...lightmapTools,
  ...lightmapReadTools,
  ...visleafTools,
  ...visTools,
  ...reportTools,
  ...vmfTools,
  ...contentTools,
  ...surfacePropsTools,
  ...particleTools,
  ...wavTools,
  ...soundscriptTools,
  ...soundscapeTools,
  ...solidTools,
  ...spaceTools,
  ...sceneTools,
  ...measureTools2,
  ...rulesTools,
  ...renderTools,
  ...renderBspTools,
  ...planTools,
  ...prefabTools,
  ...bspLumpTools,
  ...staticPropTools,
  ...qcTools,
  ...modelCheckTools,
  ...modelCollisionTools,
  ...modelAnimationTools,
  ...modelSkeletonTools,
  ...vtaTools,
  ...modelEyesTools,
  ...modelJiggleTools,
  ...modelProceduralTools,
  ...modelLodTools,
  ...modelAniTools,
  ...decompileModelTools,
  ...modelFlexTools,
  ...previewModelTools,
  ...fbxTools,
  ...smdTools,
  ...dmxSmdTools,
  ...gltfTools,
  ...gltfDmxTools,
  ...brushTools,
  ...sequencesTools,
  ...previewTools,
  ...displacementTools,
  ...diffTools,
  ...detailTools,
  ...posterTools,
  ...particleCheckTools,
  ...dressingTools,
  ...entityFamilyTools,
  ...entityProbeTools,
  ...navAttributeTools,
  ...classProbeTools,
  ...navProbeTools,
  ...entityExtraTools,
  ...reviewTools,
  ...exportMapTools,
  ...finaleTools,
  ...navTroubleTools,
  ...navAreasTools,
  ...navPathTools,
  ...navDetailsTools,
  ...navConnectionTools,
  ...buildTools,
  ...modifyTools,
  ...mergeTools,
  ...snapTools,
  ...instanceCreateTools,
  ...instanceCollapseTools,
  ...clipTools,
  ...vertexTools,
  ...hollowTools,
  ...carveTools,
  ...assetCheckTools,
  ...hullTools,
  ...faceTools,
  ...organiseTools,
  ...optimiseTools,
  ...depsTools,
  ...wiringTools,
  ...vmfEditTools,
  ...compileTools,
  ...renameTools,
  ...cubemapTools,
  ...cubemapGridTools,
  ...loadingScreenTools,
  ...vmtCheckTools,
  ...soundCheckTools,
  ...pakfileTools,
  ...pakfileAddTools,
  ...vtfTools,
  ...vtfGenTools,
  ...vtfConvertTools,
  ...dmxTools,
  ...vpkTools,
  ...vpkVerifyTools,
  ...vmtTools,
  ...runtimeTools,
  ...vscriptTools,
  ...overlayTools,
  ...overlayReadTools,
  ...instanceTools,
  ...skyboxTools,
  ...skyboxCopyTools,
  ...skyboxBuildTools,
  ...rectTools,
  ...weatherTools,
  ...worldspawnTools,
  ...textTools,
  ...terrainTools,
  ...waterTools,
  ...doorTools,
  ...studiomdlTools,
];
