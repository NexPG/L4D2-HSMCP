/**
 * The PVS behind vvis: cluster count, each cluster's compressed byte vector, and the list of
 * clusters one cluster can see.
 *
 * `read_visleaf_stats` reports leaves and the cluster header; this reads the `dvis_t` offset
 * table and the bit vectors themselves. That is what Hammer++'s "visleaf" view and a mapper's
 * "why can the infected see me from there" question actually need.
 */
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { BspFormatError, readAt, readHeader } from "../bsp/header.js";
import { readVisleafStats } from "../bsp/visleaf.js";

const LUMP_VISIBILITY = 4;

export const readBspVisTool = defineTool({
  name: "read_bsp_vis",
  description:
    "Reads a vis'd .bsp's PVS: cluster count, the compressed byte-vector size of every " +
    "cluster, the leaves with no cluster, and — for a selected `cluster` — the clusters it " +
    "can see. An unvised map is named, not guessed. Use read_visleaf_stats for leaf bounds " +
    "and the cluster header alone.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    cluster: z.number().int().min(0).optional().describe("Decode this cluster's PVS."),
    maxVisible: z.number().int().min(1).max(100_000).default(10_000),
  },
  outputSchema: {
    path: z.string(),
    leafCount: z.number(),
    clusterCount: z.number(),
    noClusterLeafCount: z.number(),
    visibilityBytes: z.number(),
    pvs: z.object({
      minBytes: z.number(),
      averageBytes: z.number(),
      maxBytes: z.number(),
      totalBytes: z.number(),
    }),
    cluster: z.number().nullable(),
    visibleClusters: z.array(z.number()),
    visibleCount: z.number(),
    truncated: z.boolean(),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const stats = readVisleafStats(path);
    const header = readHeader(path);
    const lump = header.lumps[LUMP_VISIBILITY];
    if (!lump || lump.length < 8) {
      throw new Error(`${path} has no VISIBILITY lump; run vvis on this map`);
    }
    if (lump.compressed) {
      throw new BspFormatError(
        `${path}: VISIBILITY lump is LZMA-compressed; refusing to decode it as dvis_t`,
      );
    }
    const bytes = readAt(path, lump.offset, lump.length);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const clusterCount = view.getInt32(0, true);
    if (clusterCount <= 0) {
      throw new Error(`${path}: VISIBILITY header says ${clusterCount} clusters; this map is unvised`);
    }
    if (4 + clusterCount * 4 > bytes.length) {
      throw new BspFormatError(
        `${path}: ${clusterCount} cluster offsets need ${4 + clusterCount * 4} bytes, ` +
          `but the VISIBILITY lump is ${bytes.length}`,
      );
    }
    const offsets: number[] = [];
    for (let i = 0; i < clusterCount; i += 1) {
      offsets.push(view.getInt32(4 + i * 4, true));
    }
    const vectorBytes = Math.ceil(clusterCount / 8);
    for (let i = 0; i < clusterCount; i += 1) {
      const start = offsets[i]!;
      if (start < 0 || start + vectorBytes > bytes.length) {
        throw new BspFormatError(
          `${path}: cluster ${i} PVS starts at ${start} and needs ${vectorBytes} bytes, ` +
            `outside the ${bytes.length}-byte lump`,
        );
      }
    }
    const total = vectorBytes * clusterCount;

    const wanted = args.cluster;
    const visibleClusters: number[] = [];
    let truncated = false;
    if (wanted !== undefined) {
      if (wanted >= clusterCount) {
        throw new Error(`cluster ${wanted} does not exist; this map has ${clusterCount}`);
      }
      const start = offsets[wanted]!;
      const max = args.maxVisible ?? 10_000;
      for (let index = 0; index < clusterCount; index += 1) {
        const bit = start + (index >> 3);
        if ((bytes[bit]! & (1 << (index & 7))) === 0) continue;
        if (visibleClusters.length >= max) {
          truncated = true;
          break;
        }
        visibleClusters.push(index);
      }
    }

    return {
      path,
      leafCount: stats.leafCount,
      clusterCount,
      noClusterLeafCount: stats.noClusterLeafCount,
      visibilityBytes: bytes.length,
      pvs: {
        minBytes: vectorBytes,
        averageBytes: vectorBytes,
        maxBytes: vectorBytes,
        totalBytes: total,
      },
      cluster: wanted ?? null,
      visibleClusters,
      visibleCount: visibleClusters.length,
      truncated,
      nextStep:
        "A PVS is a set of clusters, not a guarantee: OBSCURED and BATTLEFIELD nav attributes " +
        "change what the Director does with the same visibility.",
    };
  },
});

export const visTools = [readBspVisTool];
