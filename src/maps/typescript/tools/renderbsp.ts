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
import { readHeader } from "../bsp/header.js";
import { readBspPolygons } from "../bsp/polygons.js";
import { readFaceLightmapAverages } from "../bsp/lightmap.js";
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
    "BSP (FACES/HDR, SURFEDGES, EDGES, VERTEXES), and each face's colour is its baked " +
    "lightmap average when lighting exists; faces without a lightmap fall back to the same " +
    "stable material colour as render_vmf_view. No textures, props, fog or particles: this " +
    "shows form, occlusion and baked light. Camera convention is Source's (angles " +
    "pitch/yaw/roll, fov horizontal). Omit origin/angles to frame the whole map.",
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

    const faces: SceneFace[] = polygons.faces.map((polygon) => {
      const sky = (polygon.flags & 0x4) !== 0 || isSkyMaterial(polygon.material);
      const average = averages.averages.get(polygon.index);
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
      "Face colour is the baked lightmap average. No textures, props, fog or particles: " +
        "this shows compiled form, occlusion and light, not what the place looks like.",
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
