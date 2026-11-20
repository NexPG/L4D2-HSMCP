import { z } from "zod";
import { readFileSync } from "node:fs";
import { readEntityLump } from "../bsp/entities.js";
import { readBspFaces } from "../bsp/faces.js";
import { HDR_LUMPS, readHeader } from "../bsp/header.js";
import { parseNavDump } from "../../../nav/typescript/bsp/navdump.js";
import { histogram, matchesFilter } from "../entity/model.js";
import type { EntityFilter, Vec3 } from "../entity/model.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";

const VEC3 = z.array(z.number()).length(3);

const ENTITY_QUERY = {
  classname: z.string().optional().describe("Exact classname match."),
  classnameContains: z.string().optional().describe("Substring match on classname."),
  targetname: z.string().optional().describe("Exact targetname match."),
  near: VEC3.optional().describe("Centre of a radius search, as [x, y, z]."),
  radius: z.number().positive().optional().describe("Radius for `near` (default 512)."),
  limit: z.number().int().min(1).max(2000).default(200),
  offset: z.number().int().min(0).default(0),
};

function toFilter(a: Record<string, unknown>): EntityFilter {
  return {
    ...(a["classname"] ? { classname: a["classname"] as string } : {}),
    ...(a["classnameContains"]
      ? { classnameContains: a["classnameContains"] as string }
      : {}),
    ...(a["targetname"] ? { targetname: a["targetname"] as string } : {}),
    ...(a["near"] ? { near: a["near"] as Vec3 } : {}),
    ...(a["radius"] ? { radius: a["radius"] as number } : {}),
  };
}

export const readBspInfo = defineTool({
  name: "read_bsp_info",
  description:
    "Header of a compiled .bsp: ident, version, mapRevision and all 64 lumps with their " +
    "offset and size. Reads only the first 1036 bytes, so it is instant even on a 1 GB map. " +
    "mapRevision is the build stamp a compiled map carries.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    /** Most lumps are empty; listing all 64 is noise unless you asked for it. */
    allLumps: z
      .boolean()
      .default(false)
      .describe("Include empty lumps (default: only lumps with content)."),
  },
  outputSchema: {
    path: z.string(),
    ident: z.string(),
    version: z.number(),
    mapRevision: z.number().describe("The compiled map's build stamp."),
    fileSize: z.number(),
    lumpCount: z.number(),
    hdrLighting: z
      .boolean()
      .describe(
        "Whether vrad produced HDR lighting, from lumps 53/54/58 being present. NOT from " +
          "lump 56: LEAF_AMBIENT_LIGHTING is per-visleaf ambient and exists in LDR maps too, " +
          "so reading it as HDR reports every LDR map as HDR-compiled.",
      ),
    lumps: z.array(
      z.object({
        index: z.number(),
        name: z.string().nullable(),
        offset: z.number(),
        length: z.number().describe("Bytes in the file. For a compressed lump, the COMPRESSED size."),
        megabytes: z.number(),
        version: z.number(),
        compressed: z.boolean().describe("Individually LZMA-compressed, read from the lump's magic."),
        declaredUncompressedBytes: z
          .number()
          .nullable()
          .describe("What a compressed lump declares in fourCC. Declared, not verified here."),
      }),
    ),
  },
  handler: (args, ctx) => {
    const header = readHeader(resolveInput(args.path, ctx.config));
    const lumps = args.allLumps ? header.lumps : header.lumps.filter((l) => l.length > 0);
    return {
      path: header.path,
      ident: header.ident,
      version: header.version,
      mapRevision: header.mapRevision,
      fileSize: header.fileSize,
      lumpCount: lumps.length,
      hdrLighting: HDR_LUMPS.some((i) => (header.lumps[i]?.length ?? 0) > 0),
      lumps: [...lumps]
        .sort((a, b) => b.length - a.length)
        .map((l) => ({
          index: l.index,
          name: l.name ?? null,
          offset: l.offset,
          length: l.length,
          megabytes: Math.round((l.length / 1048576) * 100) / 100,
          version: l.version,
          compressed: l.compressed,
          declaredUncompressedBytes: l.declaredUncompressedBytes,
        })),
    };
  },
});

export const readBspEntities = defineTool({
  name: "read_bsp_entities",
  description:
    "Entities of a compiled .bsp, read from lump 0. Returns a classname histogram plus a " +
    "filtered, paginated entity list. Seeks straight to the lump -- on a 1 GB map this reads " +
    "about 1.5 MB. Note that a compiled lump has no Hammer ids; entities are keyed by index.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    ...ENTITY_QUERY,
    histogramOnly: z
      .boolean()
      .default(false)
      .describe("Return only the classname histogram and counts."),
  },
  outputSchema: {
    path: z.string(),
    mapRevision: z.number(),
    lumpBytes: z.number(),
    nulTerminated: z.boolean(),
    total: z.number(),
    matched: z.number(),
    histogram: z.record(z.number()),
    // Absent when histogramOnly is set: the caller asked for counts, not entities.
    returned: z.number().optional(),
    truncated: z.boolean().optional(),
    entities: z
      .array(
        z.object({
          index: z.number(),
          classname: z.string(),
          targetname: z.string().nullable(),
          origin: VEC3.nullable(),
          angles: VEC3.nullable(),
          keyvalues: z.record(z.string()),
        }),
      )
      .optional(),
  },
  /**
   * The entity list is the product here, not an accident, so it is worth raising the
   * client's inline-result ceiling for it rather than having a 200-entity page spilled
   * to a file the agent then has to go read.
   *
   * Client-specific and unverified from here: an unrecognised key is ignored in silence.
   * Pagination stays the real defence -- `limit` caps at 2000 whatever the client does.
   */
  meta: { "anthropic/maxResultSizeChars": 200_000 },
  handler: (args, ctx) => {
    const lump = readEntityLump(resolveInput(args.path, ctx.config));
    const all = lump.entities;
    const filtered = all.filter((e) => matchesFilter(e, toFilter(args)));
    // Defaults live in the schema, and the MCP layer applies them; a direct handler call
    // (tests, campaign builds) does not. `slice(0, 0 + undefined)` returned [] for every
    // filter, which looked like a broken classname filter rather than an unparsed default.
    const limit = args.limit ?? 200;
    const offset = args.offset ?? 0;
    const page = filtered.slice(offset, offset + limit);

    return {
      path: lump.header.path,
      mapRevision: lump.header.mapRevision,
      lumpBytes: lump.text.length,
      nulTerminated: lump.nulTerminated,
      total: all.length,
      matched: filtered.length,
      histogram: Object.fromEntries(histogram(all)),
      ...(args.histogramOnly
        ? {}
        : {
            returned: page.length,
            truncated: offset + page.length < filtered.length,
            entities: page.map((e) => ({
              index: e.index,
              classname: e.classname,
              targetname: e.targetname ?? null,
              origin: e.origin ?? null,
              angles: e.angles ?? null,
              keyvalues: Object.fromEntries(e.keyvalues),
            })),
          }),
    };
  },
});

const readNavDump = defineTool({
  name: "read_nav_dump",
  description:
    "Reads the `<map>_nav.txt` dump the engine writes beside a generated nav mesh: every " +
    "area's centre, its connections, and its attribute flags decoded — CHECKPOINT, " +
    "PLAYER_START, FINALE and the computed escape route. Answers whether the mesh is a " +
    "map the Director can run (a goal area plus a flow path) without loading the game. " +
    "The dump is text; the .nav binary layout is not parsed here.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the <map>_nav.txt dump."),
    limit: z.number().int().min(1).max(2000).default(200).describe("Areas to return."),
    offset: z.number().int().min(0).default(0).describe("Areas to skip."),
  },
  outputSchema: {
    path: z.string(),
    areaCount: z.number(),
    returned: z.number(),
    areas: z.array(
      z.object({
        center: VEC3,
        north: z.number(),
        east: z.number(),
        south: z.number(),
        west: z.number(),
        baseFlags: z.number(),
        terrorFlags: z.number(),
        attributes: z.array(z.string()),
        connections: z.number(),
      }),
    ),
    summary: z.object({
      checkpoint: z.number(),
      playerStart: z.number(),
      finale: z.number(),
      escapeRoute: z.number(),
      areasWithConnections: z.number(),
    }),
    verdict: z.enum(["playable", "no-goal", "no-flow", "empty"]),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const report = parseNavDump(path, readFileSync(path, "utf8"));
    const limit = args.limit ?? 200;
    const offset = args.offset ?? 0;
    const page = report.areas.slice(offset, offset + limit);
    return {
      path: report.path,
      areaCount: report.areaCount,
      returned: page.length,
      areas: page,
      summary: report.summary,
      verdict: report.verdict,
    };
  },
});

export const readBspFacesTool = defineTool({
  name: "read_bsp_faces",
  description:
    "Reads a compiled map's faces: the material, smoothing-group bitmask, lightmap footprint " +
    "and texture vectors vbsp actually produced. This is the result side of read_vmf_surfaces " +
    "-- a `.vmf` says `lightmapscale 32` and `smoothing_groups 4096`, and only the BSP says " +
    "how many luxels the face got and which mask vrad will read. Filter by material or by " +
    "exact smoothing mask; the texture vectors are omitted unless asked for, because they " +
    "are four floats per face and rarely what a caller needs. Reads FACES, TEXINFO and the " +
    "texdata string table by offset, never the whole file.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    material: z
      .string()
      .optional()
      .describe("Only faces whose material contains this text. Case-insensitive."),
    smoothingGroups: z
      .number()
      .int()
      .optional()
      .describe("Only faces with exactly this bitmask. Group 13 is 1 << 12 = 4096."),
    includeVectors: z
      .boolean()
      .default(false)
      .describe("Return the U/V texture vectors. Four floats per face."),
    limit: z.number().int().min(1).max(2000).default(200),
  },
  outputSchema: {
    path: z.string(),
    mapRevision: z.number(),
    faceCount: z.number(),
    filtered: z.number(),
    returned: z.number(),
    truncated: z.boolean(),
    materials: z.array(z.object({ name: z.string(), faces: z.number() })),
    faces: z.array(
      z.object({
        index: z.number(),
        material: z.string(),
        smoothingGroups: z.number(),
        area: z.number(),
        lightofs: z.number(),
        sizeLuxels: z.tuple([z.number(), z.number()]),
        luxels: z.number(),
        flags: z.number(),
        textureVecs: z
          .tuple([
            z.tuple([z.number(), z.number(), z.number(), z.number()]),
            z.tuple([z.number(), z.number(), z.number(), z.number()]),
          ])
          .optional(),
      }),
    ),
  },
  handler: (args, ctx) => {
    const report = readBspFaces(resolveInput(args.path, ctx.config), {
      ...(args.material !== undefined ? { material: args.material } : {}),
      ...(args.smoothingGroups !== undefined ? { smoothingGroups: args.smoothingGroups } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
    return {
      path: report.header.path,
      mapRevision: report.header.mapRevision,
      faceCount: report.faceCount,
      filtered: report.filtered,
      returned: report.faces.length,
      truncated: report.truncated,
      materials: report.materials,
      faces: report.faces.map((face) => ({
        index: face.index,
        material: face.material,
        smoothingGroups: face.smoothingGroups,
        area: Math.round(face.area * 100) / 100,
        lightofs: face.lightofs,
        sizeLuxels: face.sizeLuxels,
        luxels: face.luxels,
        flags: face.flags,
        ...(args.includeVectors === true ? { textureVecs: face.textureVecs } : {}),
      })),
    };
  },
});

export const bspTools = [readBspInfo, readBspEntities, readBspFacesTool, readNavDump];
