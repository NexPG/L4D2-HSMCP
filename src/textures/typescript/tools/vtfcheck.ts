/**
 * `check_vtf`: the header rules a texture can break without failing a compile.
 *
 * These are the defects that surface as "the map looks wrong" rather than as an error: a
 * `NOMIP` flag on a texture that still carries mips (a shipped Valve bug), a one-bit alpha
 * flag on a format that cannot store it, a 5120-wide sky that no L4D2 client can upload.
 *
 * It reads the 80-byte header only. The pixels are `read_vtf`'s job and the material that
 * points at the texture is `check_vmt`'s.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readVtfHeader } from "../bsp/vtf.js";

const NOMIP = 0x0100;
const NOLOD = 0x0200;
const ONEBITALPHA = 0x1000;
const L4D2_MAX_DIMENSION = 4096;

const FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
});

function powerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

export const checkVtfTool = defineTool({
  name: "check_vtf",
  description:
    "Checks a `.vtf` header against the rules the engine and L4D2 content follow: a `NOMIP` " +
    "flag on a texture that still has mip levels, `NOLOD` with mips, a one-bit-alpha flag on " +
    "a format that cannot store it, non-power-of-two dimensions, a cubemap that is not square " +
    "or is animated, and a size over 4096. Finds what makes a texture look wrong or fail to " +
    "upload, not what makes it a bad picture. Header only.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vtf, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    overall: z.enum(["pass", "warn", "fail"]),
    header: z.object({
      version: z.string(),
      width: z.number(),
      height: z.number(),
      flags: z.number(),
      format: z.string(),
      frames: z.number(),
      mipmaps: z.number(),
      cubemap: z.boolean(),
    }),
    findings: z.array(FINDING),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const header = readVtfHeader(readFileSync(path));
    if (!header) throw new Error(`${path} is not a .vtf (no VTF signature)`);

    const findings: Array<z.infer<typeof FINDING>> = [];
    const add = (severity: "error" | "warning" | "info", rule: string, message: string): void => {
      findings.push({ severity, rule, message });
    };

    if (header.mipmaps === 0) {
      add("error", "vtf-no-mipmaps", "mipmapCount is 0; the file stores no image levels");
    }
    if ((header.flags & NOMIP) !== 0 && header.mipmaps > 1) {
      add(
        "warning",
        "vtf-nomip-with-mips",
        `NOMIP is set but the file stores ${header.mipmaps} mip levels. This is Valve's own ` +
          "bug (Borealis skybox): clear the flag, or the smaller levels are dead weight",
      );
    }
    if ((header.flags & NOLOD) !== 0 && header.mipmaps > 1) {
      add(
        "warning",
        "vtf-nolod-with-mips",
        `NOLOD is set but the file stores ${header.mipmaps} mip levels; NOLOD means no ` +
          "distance levels, so either the flag or the levels are wrong",
      );
    }
    if ((header.flags & ONEBITALPHA) !== 0 && header.format !== "DXT1") {
      add(
        "warning",
        "vtf-onebit-alpha-format",
        `one-bit alpha is set on ${header.format}; only DXT1 stores it as a one-bit mask`,
      );
    }
    if (header.format === "DXT1" && (header.flags & ONEBITALPHA) !== 0) {
      add(
        "info",
        "vtf-dxt1-onebit",
        "DXT1 with one-bit alpha: legal, and the alpha channel is a mask rather than a gradient",
      );
    }
    if (header.width > L4D2_MAX_DIMENSION || header.height > L4D2_MAX_DIMENSION) {
      add(
        "warning",
        "vtf-oversize",
        `${header.width}x${header.height} is over ${L4D2_MAX_DIMENSION}; L4D2 clients do not ` +
          "upload it and the material falls back",
      );
    }
    if (!powerOfTwo(header.width) || !powerOfTwo(header.height)) {
      add(
        "warning",
        "vtf-not-power-of-two",
        `${header.width}x${header.height} is not a power of two; Source handles it only as a ` +
          "clamped, non-tiled texture, and world materials expect tiling",
      );
    }
    if (header.cubemap && header.width !== header.height) {
      add(
        "warning",
        "vtf-cubemap-not-square",
        `cube face is ${header.width}x${header.height}; every shipped cubemap is square`,
      );
    }
    if (header.cubemap && header.frames > 1) {
      add(
        "warning",
        "vtf-animated-cubemap",
        `${header.frames} frames on an env map; animated cubemaps are not supported by the ` +
          "L4D2 shaders",
      );
    }

    return {
      path,
      overall: findings.some((finding) => finding.severity === "error")
        ? ("fail" as const)
        : findings.some((finding) => finding.severity === "warning")
          ? ("warn" as const)
          : ("pass" as const),
      header,
      findings,
    };
  },
});

export const vtfCheckTools = [checkVtfTool];
