/**
 * Render a compiled `.bsp` from a camera.
 *
 * `render_vmf_view` draws the source map from its brushes. This draws what vbsp/vrad actually
 * produced: face loops from FACES/SURFEDGES/EDGES/VERTEXES, and the face colour from the baked
 * lightmap average when lighting is present. It is the closest headless substitute for
 * Hammer++'s compiled 3D view and lighting preview: form, occlusion and baked light, without
 * textures, props, fog or particles.
 */
import { z } from "zod";
import { IMAGE_KEY } from "@projectsociety/mcp-core";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readHeader, readAt } from "../bsp/header.js";
import { readBspPolygons } from "../bsp/polygons.js";
import { readBspFaces } from "../bsp/faces.js";
import { readFaceLightmapAverages, readLightmapBudget } from "../bsp/lightmap.js";
import type { Bvh } from "../space/bvh.js";
import { MASK_SIGHT } from "../space/scene.js";
import type { Scene, SceneBrush, SceneFace } from "../space/scene.js";
import { encodePng } from "../render/png.js";
import { frameBox, isSkyMaterial, render } from "../render/raster.js";
import type { Camera } from "../render/camera.js";
import type { Vec3 } from "../vmf/solid.js";

export const renderBspViewTool = defineTool({
  name: "render_bsp_view",
  description:
    "Renders a COMPILED .bsp from a camera and returns the picture. Face loops come from the " +
    "BSP (FACES/HDR, SURFEDGES, EDGES, VERTEXES), and each face's colour is sampled per pixel " +
    "from its baked lightmap grid with a perspective-correct UV; the face average and the " +
    "material colour are fallbacks. Faces without a lightmap use the stable material colour " +
    "as render_vmf_view does. No textures, props, fog or particles: this shows form, occlusion " +
    "and baked light. Camera convention is Source's (angles pitch/yaw/roll, fov horizontal). " +
    "Omit origin/angles to frame the whole map.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    origin: z.array(z.number()).length(3).optional().describe("Eye position."),
    angles: z
      .array(z.number())
      .length(3)
      .optional()
      .describe("Pitch, yaw, roll in degrees. Positive pitch looks down."),
    fov: z.number().min(10).max(150).default(90),
    width: z.number().int().min(64).max(1024).default(640),
    height: z.number().int().min(64).max(1024).default(360),
    near: z.number().positive().default(8),
    lighting: z
      .enum(["auto", "hdr", "ldr", "none"])
      .default("auto")
      .describe("Baked lighting source; `none` renders material colours with the fixed light."),
  },
  outputSchema: {
    path: z.string(),
    origin: z.array(z.number()),
    angles: z.array(z.number()),
    fov: z.number(),
    width: z.number(),
    height: z.number(),
    lighting: z.enum(["ldr", "hdr", "none"]),
    faceCount: z.number(),
    lightmapFaces: z.number(),
    gradientFaces: z.number(),
    facesDrawn: z.number(),
    facesCulled: z.number(),
    facesBehind: z.number(),
    pngBytes: z.number(),
    notes: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const header = readHeader(path);
    const requested = args.lighting ?? "auto";
    const useHdr =
      requested === "hdr" ||
      (requested === "auto" && (header.lumps[53]?.length ?? 0) > 0);
    const lighting: "ldr" | "hdr" | "none" =
      requested === "none" ? "none" : useHdr ? "hdr" : "ldr";

    const polygons = readBspPolygons(path, useHdr);
    const averages =
      lighting === "none"
        ? { source: lighting, averages: new Map<number, [number, number, number]>() }
        : readFaceLightmapAverages(path, useHdr === true);
    const surfaces = readBspFaces(path, { limit: 1_000_000 });
    const surfaceByIndex = new Map(surfaces.faces.map((face) => [face.index, face]));
    const lightBudget = readLightmapBudget(path, useHdr ? 58 : 7);
    const lightFaceByIndex = new Map(lightBudget.faces.map((face) => [face.index, face]));
    const lightingLump = header.lumps[useHdr ? 53 : 8];
    const lightingBytes =
      lighting !== "none" && lightingLump && !lightingLump.compressed && lightingLump.length > 0
        ? readAt(path, lightingLump.offset, lightingLump.length)
        : null;
    const stride = 4;
    const lightmapFor = (
      polygon: (typeof polygons.faces)[number],
    ): NonNullable<SceneFace["lightmap"]> | null => {
      if (!lightingBytes) return null;
      const surface = surfaceByIndex.get(polygon.index);
      const lightFace = lightFaceByIndex.get(polygon.index);
      if (!surface || !lightFace || !lightFace.hasLightmap) return null;
      const [sizeX, sizeY] = lightFace.sizeLuxels;
      if (sizeX < 0 || sizeY < 0) return null;
      const width = sizeX + 1;
      const height = sizeY + 1;
      const bytes = width * height * stride;
      if (lightFace.lightofs < 0 || lightFace.lightofs + bytes > lightingBytes.length) {
        return null;
      }
      const data = new Uint8Array(width * height * 3);
      for (let luxel = 0; luxel < width * height; luxel += 1) {
        const at = lightFace.lightofs + luxel * stride;
        data[luxel * 3] = lightingBytes[at]!;
        data[luxel * 3 + 1] = lightingBytes[at + 1]!;
        data[luxel * 3 + 2] = lightingBytes[at + 2]!;
      }
      const [uVec, vVec] = surface.textureVecs;
      const sValues = polygon.points.map(
        (point) => point[0] * uVec[0] + point[1] * uVec[1] + point[2] * uVec[2] + uVec[3],
      );
      const tValues = polygon.points.map(
        (point) => point[0] * vVec[0] + point[1] * vVec[1] + point[2] * vVec[2] + vVec[3],
      );
      const sMin = Math.min(...sValues);
      const sMax = Math.max(...sValues);
      const tMin = Math.min(...tValues);
      const tMax = Math.max(...tValues);
      if (sMax - sMin <= 0 || tMax - tMin <= 0) return null;
      const uvs: Array<[number, number]> = sValues.map((s, index) => [
        ((s - sMin) / (sMax - sMin)) * sizeX,
        ((tValues[index]! - tMin) / (tMax - tMin)) * sizeY,
      ]);
      return { width, height, data, uvs };
    };
    let gradientFaces = 0;

    const faces: SceneFace[] = polygons.faces.map((polygon) => {
      const sky = (polygon.flags & 0x4) !== 0 || isSkyMaterial(polygon.material);
      const average = averages.averages.get(polygon.index);
      const lightmap = sky ? null : lightmapFor(polygon);
      if (lightmap) gradientFaces += 1;
      return {
        sideId: null,
        material: polygon.material,
        plane: { normal: polygon.normal, dist: polygon.dist },
        loop: polygon.points,
        area: 0,
        ...(sky
          ? { colour: [92, 132, 178] as [number, number, number], shade: 1 }
          : average
            ? { colour: average, shade: 1 }
            : {}),
        ...(lightmap ? { lightmap } : {}),
      };
    });
    const brush: SceneBrush = {
      id: -1,
      index: 0,
      owner: "bsp",
      planes: faces.map((face) => face.plane),
      faces,
      mins: polygons.mins,
      maxs: polygons.maxs,
      mask: MASK_SIGHT,
      hasDisplacement: false,
    };
    const scene: Scene = {
      path,
      brushes: [brush],
      bvh: {} as Bvh,
      mins: polygons.mins,
      maxs: polygons.maxs,
      excluded: { displacement: 0, nonSolid: 0, invalid: 0 },
      terrain: [],
    };

    let origin: Vec3;
    let angles: Vec3;
    const notes: string[] = [];
    if (args.origin && args.origin.length === 3) {
      origin = args.origin as unknown as Vec3;
      angles = (args.angles as unknown as Vec3) ?? [0, 0, 0];
    } else {
      const framed = frameBox(
        scene.mins,
        scene.maxs,
        { fov: args.fov, width: args.width, height: args.height },
        45,
        35,
      );
      origin = framed.origin;
      angles = framed.angles;
      notes.push(
        "No camera given, so the whole map is framed from outside at yaw 45, pitch 35.",
      );
    }

    const camera: Camera = {
      origin,
      angles,
      fov: args.fov,
      width: args.width,
      height: args.height,
      near: args.near,
    };
    const fb = render(scene, camera);
    const png = encodePng(fb.rgb, fb.width, fb.height);
    notes.push(
      "Face colour is the baked lightmap, sampled per pixel from the face's grid with a " +
        "perspective-correct UV. No textures, props, fog or particles: this shows compiled " +
        "form, occlusion and light, not what the place looks like.",
    );
    if (lighting === "none") {
      notes.push("Lighting was disabled, so faces use the stable material colour and one light.");
    } else if (averages.averages.size === 0) {
      notes.push(
        `No baked ${lighting.toUpperCase()} lightmap samples were readable; faces use the ` +
          `material colour fallback.`,
      );
    }

    return {
      path,
      origin: [...origin],
      angles: [...angles],
      fov: args.fov,
      width: fb.width,
      height: fb.height,
      lighting,
      faceCount: polygons.faceCount,
      lightmapFaces: averages.averages.size,
      gradientFaces,
      facesDrawn: fb.facesDrawn,
      facesCulled: fb.facesCulled,
      facesBehind: fb.facesBehind,
      pngBytes: png.length,
      notes,
      [IMAGE_KEY]: { data: png.toString("base64"), mimeType: "image/png" },
    };
  },
});

export const renderBspTools = [renderBspViewTool];
