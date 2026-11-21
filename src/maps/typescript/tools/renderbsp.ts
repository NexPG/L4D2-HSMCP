/**
 * Render a compiled `.bsp` from a camera.
 *
 * `render_vmf_view` draws the source map from its brushes. This draws what vbsp/vrad actually
 * produced: face loops from FACES/SURFEDGES/EDGES/VERTEXES, textures from the game's VMT/VTF,
 * baked light from the lightmap, static props from the `sprp` game lump and their
 * MDL/VVD/VTX, and the ambient cube at each prop's leaf. It is the closest headless substitute
 * for Hammer++'s compiled 3D view and lighting preview: form, occlusion, texture, props and
 * light, without dynamic entities, fog or particles.
 */
import { z } from "zod";
import { IMAGE_KEY } from "@projectsociety/mcp-core";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readHeader, readAt } from "../bsp/header.js";
import { readBspPolygons } from "../bsp/polygons.js";
import { readBspFaces } from "../bsp/faces.js";
import { readFaceLightmapAverages, readLightmapBudget } from "../bsp/lightmap.js";
import { readStaticProps } from "../bsp/staticprops.js";
import { readAmbientLighting } from "../bsp/ambient.js";
import type { AmbientLighting } from "../bsp/ambient.js";
import { materialTexture, openGameVpk } from "../../../assets/typescript/game/vpkcontent.js";
import { loadModelTextures } from "../../../assets/typescript/game/models.js";
import type { ModelTextureSet } from "../../../assets/typescript/game/models.js";
import type { ModelGeometry } from "../../../models/typescript/formats/mdlmesh.js";
import { basisOf, toView } from "../render/camera.js";
import type { Bvh } from "../space/bvh.js";
import { MASK_SIGHT } from "../space/scene.js";
import type { Scene, SceneBrush, SceneFace } from "../space/scene.js";
import { encodePng } from "../render/png.js";
import { frameBox, isSkyMaterial, render } from "../render/raster.js";
import type { Camera } from "../render/camera.js";
import type { Vec3 } from "../vmf/solid.js";

/** The yaw/pitch/roll matrix in Source's row-vector convention. */
function angleMatrix(angles: Vec3): [Vec3, Vec3, Vec3] {
  const [pitch, yaw, roll] = angles.map((value) => (value * Math.PI) / 180) as unknown as Vec3;
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  return [
    [cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy],
    [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy],
    [-sp, sr * cp, cr * cp],
  ];
}

function rotateBy(m: [Vec3, Vec3, Vec3], point: Vec3): Vec3 {
  return [
    point[0] * m[0][0] + point[1] * m[0][1] + point[2] * m[0][2],
    point[0] * m[1][0] + point[1] * m[1][1] + point[2] * m[1][2],
    point[2] * m[2][2] + point[0] * m[2][0] + point[1] * m[2][1],
  ];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length < 1e-6) return [0, 0, 1];
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * Appends the static props a camera can see to `faces`.
 *
 * Geometry is cached per model+skin, so a street lamp repeated fifty times is parsed once.
 * Props are culled by distance and by their bounding sphere against the camera frustum;
 * a triangle budget stops a close-up of a detailed prop from making the whole render
 * quadratic. The report says how many were skipped, so a picture missing scenery is not
 * mistaken for a map without it.
 */
function addProps(
  faces: SceneFace[],
  path: string,
  camera: Camera,
  vpk: NonNullable<ReturnType<typeof openGameVpk>>,
  ambient: AmbientLighting | null,
  distance: number,
  triangleBudget: number,
): {
  total: number;
  drawn: number;
  culled: number;
  missingModels: number;
  triangles: number;
  truncated: boolean;
} {
  const propList = readStaticProps(path);
  const basis = basisOf(camera.angles);
  const halfFov = Math.tan((camera.fov * Math.PI) / 360);
  const cache = new Map<string, ModelTextureSet | null>();
  let drawn = 0;
  let culled = 0;
  let missingModels = 0;
  let triangles = 0;
  let truncated = false;

  for (const prop of propList.props) {
    if (triangles >= triangleBudget) {
      truncated = true;
      culled += 1;
      continue;
    }
    const dx = prop.origin[0] - camera.origin[0];
    const dy = prop.origin[1] - camera.origin[1];
    const dz = prop.origin[2] - camera.origin[2];
    if (Math.hypot(dx, dy, dz) > distance) {
      culled += 1;
      continue;
    }
    const key = `${prop.model}|${prop.skin}`;
    let model = cache.get(key);
    if (model === undefined) {
      model = loadModelTextures(vpk, prop.model, prop.skin);
      cache.set(key, model);
    }
    if (!model) {
      missingModels += 1;
      continue;
    }
    const geometry: ModelGeometry = model.geometry;
    const scale = Math.max(prop.scale[0], prop.scale[1], prop.scale[2]);
    const r = geometry.radius * scale;

    const matrix = angleMatrix(prop.angles);
    const centre: Vec3 = [
      ((geometry.hullMin[0] + geometry.hullMax[0]) / 2) * prop.scale[0],
      ((geometry.hullMin[1] + geometry.hullMax[1]) / 2) * prop.scale[1],
      ((geometry.hullMin[2] + geometry.hullMax[2]) / 2) * prop.scale[2],
    ];
    const rotated = rotateBy(matrix, centre);
    const worldCentre: Vec3 = [
      rotated[0] + prop.origin[0],
      rotated[1] + prop.origin[1],
      rotated[2] + prop.origin[2],
    ];
    const view = toView(camera, basis, worldCentre);
    if (view.z + r < camera.near) {
      culled += 1;
      continue;
    }
    const halfX = halfFov * Math.max(0.001, view.z);
    const halfY = halfX * (camera.height / camera.width);
    if (Math.abs(view.x) - r > halfX || Math.abs(view.y) - r > halfY) {
      culled += 1;
      continue;
    }

    const propTriangles = geometry.triangleCount;
    if (triangles + propTriangles > triangleBudget) {
      truncated = true;
      culled += 1;
      continue;
    }

    const tint = (prop.tint[0] * 0.299 + prop.tint[1] * 0.587 + prop.tint[2] * 0.114) / 255;
    const leaf = ambient?.leafAt(prop.origin) ?? -1;
    let added = 0;
    for (let meshIndex = 0; meshIndex < geometry.meshes.length; meshIndex += 1) {
      const mesh = geometry.meshes[meshIndex]!;
      const material = model.meshMaterials[meshIndex] ?? "";
      const decoded = model.textures[meshIndex] ?? null;
      for (let t = 0; t + 2 < mesh.triangles.length; t += 3) {
        const va = mesh.vertices[mesh.triangles[t]!]!;
        const vb = mesh.vertices[mesh.triangles[t + 1]!]!;
        const vc = mesh.vertices[mesh.triangles[t + 2]!]!;
        const pa: Vec3 = [
          va.position[0] * prop.scale[0],
          va.position[1] * prop.scale[1],
          va.position[2] * prop.scale[2],
        ];
        const pb: Vec3 = [
          vb.position[0] * prop.scale[0],
          vb.position[1] * prop.scale[1],
          vb.position[2] * prop.scale[2],
        ];
        const pc: Vec3 = [
          vc.position[0] * prop.scale[0],
          vc.position[1] * prop.scale[1],
          vc.position[2] * prop.scale[2],
        ];
        const rpa = rotateBy(matrix, pa);
        const rpb = rotateBy(matrix, pb);
        const rpc = rotateBy(matrix, pc);
        const a: Vec3 = [rpa[0] + prop.origin[0], rpa[1] + prop.origin[1], rpa[2] + prop.origin[2]];
        const b: Vec3 = [rpb[0] + prop.origin[0], rpb[1] + prop.origin[1], rpb[2] + prop.origin[2]];
        const c: Vec3 = [rpc[0] + prop.origin[0], rpc[1] + prop.origin[1], rpc[2] + prop.origin[2]];
        const na = rotateBy(matrix, va.normal);
        const nb = rotateBy(matrix, vb.normal);
        const nc = rotateBy(matrix, vc.normal);
        const sum: Vec3 = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
        let normal = Math.hypot(...sum) > 1e-6 ? unit(sum) : ([0, 0, 1] as Vec3);
        if (Math.hypot(...sum) <= 1e-6) {
          const winding = cross(
            [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
            [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
          );
          if (Math.hypot(...winding) > 1e-6) normal = unit(winding);
        }
        const shade = (0.85 + 0.15 * Math.abs(normal[2])) * tint;
        const modulate = ambient && leaf >= 0 ? ambient.sampleLeaf(leaf, normal) : null;
        faces.push({
          sideId: null,
          material,
          plane: {
            normal,
            dist: normal[0] * a[0] + normal[1] * a[1] + normal[2] * a[2],
          },
          loop: [a, b, c],
          area: 0,
          colour: [prop.tint[0], prop.tint[1], prop.tint[2]],
          shade,
          twoSided: true,
          ...(modulate ? { modulate } : {}),
          ...(decoded
            ? {
                texture: {
                  width: decoded.width,
                  height: decoded.height,
                  data: decoded.rgb,
                  uvs: [
                    [va.uv[0] * decoded.width, va.uv[1] * decoded.height] as [number, number],
                    [vb.uv[0] * decoded.width, vb.uv[1] * decoded.height] as [number, number],
                    [vc.uv[0] * decoded.width, vc.uv[1] * decoded.height] as [number, number],
                  ],
                },
              }
            : {}),
        });
        added += 1;
      }
    }
    if (added > 0) {
      drawn += 1;
      triangles += added;
    } else {
      missingModels += 1;
    }
  }
  return {
    total: propList.props.length,
    drawn,
    culled,
    missingModels,
    triangles,
    truncated,
  };
}

export const renderBspViewTool = defineTool({
  name: "render_bsp_view",
  description:
    "Renders a COMPILED .bsp from a camera and returns the picture. Face loops come from the " +
    "BSP (FACES/HDR, SURFEDGES, EDGES, VERTEXES), and each face is textured with its base VMT " +
    "and lit per pixel by its baked lightmap grid, sampled with a perspective-correct UV; the " +
    "face average and material colour are fallbacks. Static props are read from the `sprp` " +
    "game lump, their MDL/VVD/VTX geometry from the game's VPKs, and lit by the baked ambient " +
    "cube at their leaf. No dynamic entities, fog or particles: this shows compiled form, " +
    "occlusion, texture, props and light. Camera convention is Source's (angles " +
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
    props: z
      .boolean()
      .default(true)
      .describe("Draw static props from the `sprp` lump. Off shows the world geometry alone."),
    propDistance: z
      .number()
      .positive()
      .default(2500)
      .describe("Props farther than this from the camera are skipped."),
    propTriangles: z
      .number()
      .int()
      .min(1000)
      .max(2_000_000)
      .default(250_000)
      .describe("Budget for model triangles; once reached, farther props are skipped."),
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
    textureFaces: z.number(),
    propsTotal: z.number(),
    propsDrawn: z.number(),
    propsCulled: z.number(),
    propsMissingModels: z.number(),
    propTriangles: z.number(),
    ambientSamples: z.number(),
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
    let textureFaces = 0;
    const vpk = ctx.config.gameDir ? openGameVpk(ctx.config.gameDir) : null;
    const textureCache = new Map<string, ReturnType<typeof materialTexture>>();
    const textureFor = (
      polygon: (typeof polygons.faces)[number],
    ): NonNullable<SceneFace["texture"]> | null => {
      if (!vpk || !polygon.material || isSkyMaterial(polygon.material)) return null;
      let texture = textureCache.get(polygon.material);
      if (texture === undefined) {
        texture = materialTexture(vpk, polygon.material);
        textureCache.set(polygon.material, texture);
      }
      if (!texture) return null;
      const surface = surfaceByIndex.get(polygon.index);
      if (!surface) return null;
      const [uVec, vVec] = surface.textureVecs;
      const uvs = polygon.points.map((point) => {
        const s = point[0] * uVec[0] + point[1] * uVec[1] + point[2] * uVec[2] + uVec[3];
        const t = point[0] * vVec[0] + point[1] * vVec[1] + point[2] * vVec[2] + vVec[3];
        return [s / texture!.width, t / texture!.height] as [number, number];
      });
      return { width: texture.width, height: texture.height, data: texture.rgb, uvs };
    };

    const faces: SceneFace[] = polygons.faces.map((polygon) => {
      const sky = (polygon.flags & 0x4) !== 0 || isSkyMaterial(polygon.material);
      const average = averages.averages.get(polygon.index);
      const lightmap = sky ? null : lightmapFor(polygon);
      const texture = sky ? null : textureFor(polygon);
      if (lightmap) gradientFaces += 1;
      if (texture) textureFaces += 1;
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
        ...(texture ? { texture } : {}),
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
    let propsTotal = 0;
    let propsDrawn = 0;
    let propsCulled = 0;
    let propsMissingModels = 0;
    let propTriangleCount = 0;
    let ambientSamples = 0;
    if (args.props !== false && vpk) {
      const ambient = readAmbientLighting(path);
      ambientSamples = ambient?.sampleCount ?? 0;
      const props = addProps(
        faces,
        path,
        camera,
        vpk,
        ambient,
        args.propDistance,
        args.propTriangles,
      );
      propsTotal = props.total;
      propsDrawn = props.drawn;
      propsCulled = props.culled;
      propsMissingModels = props.missingModels;
      propTriangleCount = props.triangles;
      if (props.total === 0) {
        notes.push("The map's `sprp` lump has no static props.");
      } else if (props.truncated) {
        notes.push(
          `Static props were stopped at the ${args.propTriangles}-triangle budget; ` +
            `${props.culled} were skipped. Raise \`propTriangles\` or move the camera closer.`,
        );
      }
      if (props.missingModels > 0) {
        notes.push(
          `${props.missingModels} static props could not be loaded from the game's VPKs ` +
            `(missing MDL/VVD/VTX or no readable mesh); they are absent from the picture.`,
        );
      }
      if (ambientSamples === 0) {
        notes.push(
          "The map has no readable ambient lightgrid, so props use one fixed light " +
            "instead of the baked per-leaf ambient cube.",
        );
      }
    } else if (args.props === false) {
      notes.push("Static props were disabled; only the compiled world geometry is drawn.");
    }
    const fb = render(scene, camera);
    const png = encodePng(fb.rgb, fb.width, fb.height);
    notes.push(
      "Faces are textured from the game's VMT/VTF and multiplied by the baked lightmap, " +
        "sampled per pixel with perspective-correct UVs. Static props are drawn from their " +
        "MDL/VVD/VTX with the prop transform. No dynamic entities, fog or particles: this " +
        "shows compiled form, occlusion, texture, props and light, not what the place looks " +
        "like.",
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
      textureFaces,
      propsTotal,
      propsDrawn,
      propsCulled,
      propsMissingModels,
      propTriangles: propTriangleCount,
      ambientSamples,
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
