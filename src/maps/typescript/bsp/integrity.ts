/**
 * Whether a compiled map is structurally sound, and whether it still matches its source.
 *
 * A `.bsp` is a header, 64 descriptors and whatever bytes they point at. The engine trusts
 * the descriptors, so a truncated file or two lumps sharing a range can load as a plausible,
 * wrong map. `readHeader` refuses many of those; this reports the rest and compares the
 * result with the VMF it came from, which is the failure a mapper actually hits: a compile
 * from last week, or a VMF edited after the last compile.
 */
import { readFileSync, statSync } from "node:fs";
import { get, parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";
import { readEntityLump } from "./entities.js";
import { readHeader } from "./header.js";
import type { BspHeader } from "./header.js";
import { readEntities } from "../vmf/edit.js";
import { checkVmfSolids } from "../vmf/solid.js";

export interface BspProblem {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface BspIntegrity {
  path: string;
  vmf: string | null;
  bytes: number;
  version: number | null;
  mapRevision: number | null;
  ok: boolean;
  stale: boolean | null;
  problems: BspProblem[];
  lumps: {
    count: number;
    nonEmpty: number;
    compressed: number;
    totalBytes: number;
  };
  entities: {
    bsp: number | null;
    vmf: number | null;
    classesMissing: string[];
  };
  skyname: {
    vmf: string | null;
    bsp: string | null;
    match: boolean | null;
  };
  solids: { vmf: number | null };
}

/** Classes vbsp expands or removes; their absence from the BSP is not a stale compile. */
const COMPILE_TIME_CLASSES = new Set([
  "func_instance",
  "func_detail",
  "func_group",
  "func_viscluster",
  "func_instance_parms",
]);

function classesOf(entities: ReadonlyArray<{ classname: string }>): Set<string> {
  return new Set(entities.map((entity) => entity.classname.toLowerCase()).filter(Boolean));
}

type EntityLike = {
  classname: string;
  keyvalues: Array<[string, string]> | Record<string, string>;
};

function skynameOf(entities: ReadonlyArray<EntityLike>): string | null {
  for (const entity of entities) {
    if (entity.classname.toLowerCase() !== "worldspawn") continue;
    const pairs = Array.isArray(entity.keyvalues)
      ? entity.keyvalues
      : Object.entries(entity.keyvalues);
    for (const [key, value] of pairs) {
      if (key.toLowerCase() === "skyname") return value;
    }
  }
  return null;
}

export function checkBsp(path: string, vmfPath?: string): BspIntegrity {
  const bytes = statSync(path).size;
  const problems: BspProblem[] = [];
  let header: BspHeader | null = null;
  let bspEntities: ReturnType<typeof readEntityLump>["entities"] | null = null;

  try {
    header = readHeader(path);
  } catch (error) {
    problems.push({
      severity: "error",
      code: "header",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (header) {
    // A descriptor that points outside the file is the truncation case; two that overlap are
    // a file assembled by hand or by a writer that moved one lump and not the other.
    const ranged = header.lumps
      .filter((lump) => lump.length > 0)
      .sort((a, b) => a.offset - b.offset);
    for (const lump of ranged) {
      if (lump.offset < 0 || lump.offset + lump.length > bytes) {
        problems.push({
          severity: "error",
          code: "lump-out-of-range",
          message:
            `lump ${lump.index} (${lump.name ?? "unnamed"}) claims ${lump.length} bytes at ` +
            `${lump.offset}, outside a ${bytes}-byte file`,
        });
      }
    }
    for (let i = 1; i < ranged.length; i += 1) {
      const previous = ranged[i - 1]!;
      const current = ranged[i]!;
      if (previous.offset + previous.length > current.offset) {
        problems.push({
          severity: "error",
          code: "lump-overlap",
          message:
            `lump ${previous.index} (${previous.name ?? "unnamed"}) ends at ` +
            `${previous.offset + previous.length}, past the start of lump ${current.index} ` +
            `(${current.name ?? "unnamed"}) at ${current.offset}`,
        });
      }
    }

    const nonEmpty = ranged.length;
    const compressed = ranged.filter((lump) => lump.compressed).length;
    const totalBytes = ranged.reduce((sum, lump) => sum + lump.length, 0);

    const entitiesLump = header.lumps[0]!;
    if (entitiesLump.compressed) {
      // Legal, and readable only through the sidecar's LZMA decoder. This check does not
      // pull that in; it says so rather than decoding compressed bytes as text.
      problems.push({
        severity: "warning",
        code: "entities-compressed",
        message:
          "the entity lump is LZMA-compressed; entity-level checks were skipped. " +
          "read_bsp_lump decodes it.",
      });
    } else {
      try {
        bspEntities = readEntityLump(path).entities;
      } catch (error) {
        problems.push({
          severity: "error",
          code: "entities-unreadable",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (bspEntities) {
      if (!bspEntities.some((entity) => entity.classname.toLowerCase() === "worldspawn")) {
        problems.push({
          severity: "error",
          code: "no-worldspawn",
          message: "the entity lump has no worldspawn; the map cannot load",
        });
      }
      if (bspEntities.length === 0) {
        problems.push({
          severity: "warning",
          code: "no-entities",
          message: "the entity lump is empty",
        });
      }
    }

    if (vmfPath) {
      const vmfText = readFileSync(vmfPath, "utf8");
      const vmfEntities = readEntities(vmfText).entities;
      const vmfSolids = checkVmfSolids(vmfPath, vmfText);
      const vmfClasses = classesOf(vmfEntities);
      const bspClasses = bspEntities ? classesOf(bspEntities) : new Set<string>();
      const classesMissing = [...vmfClasses]
        .filter((name) => !COMPILE_TIME_CLASSES.has(name) && !bspClasses.has(name))
        .sort();

      // A VMF keeps the world in a `world` block, not an `entity`; the BSP keeps it as the
      // first entity in the lump. Reading the same shape from both would report a null.
      const world = parse(vmfText).find(
        (node): node is KvBlock => node.kind === "block" && node.name === "world",
      );
      const vmfSky = world ? (get(world, "skyname") ?? null) : null;
      const bspSky = bspEntities ? skynameOf(bspEntities) : null;
      const skyMatch = vmfSky !== null && bspSky !== null ? vmfSky === bspSky : null;

      const bspMtime = statSync(path).mtimeMs;
      const vmfMtime = statSync(vmfPath).mtimeMs;
      const stale = vmfMtime > bspMtime;
      if (stale) {
        problems.push({
          severity: "warning",
          code: "stale",
          message:
            "the .vmf is newer than the .bsp; this map was edited after its last compile",
        });
      }
      if (skyMatch === false) {
        problems.push({
          severity: "warning",
          code: "skyname-mismatch",
          message: `worldspawn says ${JSON.stringify(vmfSky)} in the .vmf and ${JSON.stringify(bspSky)} in the .bsp`,
        });
      }
      if (classesMissing.length > 0) {
        problems.push({
          severity: "warning",
          code: "entity-class-missing",
          message:
            `${classesMissing.length} entity class(es) in the .vmf are absent from the .bsp: ` +
            classesMissing.slice(0, 10).join(", ") +
            (classesMissing.length > 10 ? " ..." : ""),
        });
      }

      return {
        path,
        vmf: vmfPath,
        bytes,
        version: header.version,
        mapRevision: header.mapRevision,
        ok: problems.every((problem) => problem.severity !== "error"),
        stale,
        problems,
        lumps: { count: header.lumps.length, nonEmpty, compressed, totalBytes },
        entities: { bsp: bspEntities?.length ?? null, vmf: vmfEntities.length, classesMissing },
        skyname: { vmf: vmfSky, bsp: bspSky, match: skyMatch },
        solids: { vmf: vmfSolids.solidCount },
      };
    }

    return {
      path,
      vmf: null,
      bytes,
      version: header.version,
      mapRevision: header.mapRevision,
      ok: problems.every((problem) => problem.severity !== "error"),
      stale: null,
      problems,
      lumps: { count: header.lumps.length, nonEmpty, compressed, totalBytes },
      entities: { bsp: bspEntities?.length ?? null, vmf: null, classesMissing: [] },
      skyname: { vmf: null, bsp: bspEntities ? skynameOf(bspEntities) : null, match: null },
      solids: { vmf: null },
    };
  }

  return {
    path,
    vmf: vmfPath ?? null,
    bytes,
    version: null,
    mapRevision: null,
    ok: false,
    stale: null,
    problems,
    lumps: { count: 0, nonEmpty: 0, compressed: 0, totalBytes: 0 },
    entities: { bsp: null, vmf: null, classesMissing: [] },
    skyname: { vmf: null, bsp: null, match: null },
    solids: { vmf: null },
  };
}
