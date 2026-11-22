/**
 * VMT validation. `read_vmt` says what a material contains; this says whether the engine can
 * use it: the shader is one this game knows, a non-patch material has a base texture, the base
 * texture is not a filesystem path, the compile flags are numeric, and optionally the texture
 * files exist under one of the supplied material roots.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { parseVmt, vmtCompileFlags, vmtTextures } from "../../../formats/typescript/formats/vmt.js";

const SHADERS = new Set([
  "vertexlitgeneric",
  "lightmappedgeneric",
  "unlitgeneric",
  "worldvertextransition",
  "water",
  "patch",
  "modulate",
  "sprite",
  "refract",
  "sky",
  "decalmodulate",
  "lightmappedreflective",
  "eyerefract",
  "character",
  "subrect",
  "shatter",
  "unlittwotexture",
]);

const FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
});

export const checkVmtTool = defineTool({
  name: "check_vmt",
  description:
    "Checks a .vmt as the engine will read it: known shader, `$basetexture` for a " +
    "non-patch material, no filesystem path or .vtf suffix in the texture name, numeric " +
    "%compile flags, duplicate keys and repaired braces. With `materialsDirs` it also checks " +
    "that each named texture has a `.vtf` (or a `.vmt` for a patch include), and resolves a " +
    "patch's `include` to the base material, reporting its shader and `$basetexture`; a " +
    "missing base is a warning, not an assumption. It does not compile the material; " +
    "vbsp/vtex are still the final authority.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmt, absolute or relative to the repo root."),
    materialsDirs: z
      .array(z.string())
      .default([])
      .describe("Material roots to resolve texture names against, e.g. `<addon>/materials`."),
  },
  outputSchema: {
    path: z.string(),
    shader: z.string(),
    overall: z.enum(["pass", "warn", "fail"]),
    findings: z.array(FINDING),
    counts: z.object({ error: z.number(), warning: z.number(), info: z.number() }),
    textures: z.array(z.object({ key: z.string(), texture: z.string(), found: z.boolean().nullable() })),
    patch: z
      .object({
        include: z.string().nullable(),
        resolved: z.string().nullable(),
        exists: z.boolean().nullable(),
        shader: z.string().nullable(),
        baseTexture: z.string().nullable(),
        note: z.string(),
      })
      .nullable(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const document = parseVmt(readFileSync(path, "utf8"), path);
    const findings: Array<z.infer<typeof FINDING>> = [];
    const shader = document.shader;
    if (!shader) {
      findings.push({ severity: "error", rule: "vmt-shader", message: "no shader name" });
    } else if (!SHADERS.has(shader.toLowerCase())) {
      findings.push({
        severity: "warning",
        rule: "vmt-shader-unknown",
        message: `${shader} is not one of the shaders this checker knows; the engine may still have it`,
      });
    }
    const patch = shader.toLowerCase() === "patch";
    if (patch && !document.parameters.get("include")) {
      findings.push({
        severity: "error",
        rule: "vmt-patch-include",
        message: "a patch material needs an `include` parameter",
      });
    }
    const base = document.parameters.get("$basetexture");
    if (!patch && !base) {
      findings.push({
        severity: "error",
        rule: "vmt-basetexture",
        message: "no $basetexture; the material draws nothing",
      });
    }
    if (base) {
      if (base.includes(".vtf")) {
        findings.push({
          severity: "warning",
          rule: "vmt-basetexture-extension",
          message: "$basetexture includes .vtf; material paths omit the extension",
        });
      }
      if (base.replace(/\\/g, "/").toLowerCase().startsWith("materials/")) {
        findings.push({
          severity: "warning",
          rule: "vmt-basetexture-root",
          message: "$basetexture starts with materials/; paths are relative to materials/",
        });
      }
    }
    for (const [key, value] of Object.entries(vmtCompileFlags(document))) {
      if (value !== "0" && value !== "1") {
        findings.push({
          severity: "warning",
          rule: "vmt-compile-flag",
          message: `${key} is ${JSON.stringify(value)}; compile flags expect 0 or 1`,
        });
      }
    }
    for (const duplicate of document.duplicates) {
      findings.push({
        severity: "warning",
        rule: "vmt-duplicate-key",
        message: `${duplicate} appears more than once; the engine reads the last value`,
      });
    }
    if (document.appendedBraces > 0) {
      findings.push({
        severity: "warning",
        rule: "vmt-braces",
        message: `${document.appendedBraces} closing brace(s) were missing and repaired for reading`,
      });
    }
    for (const warning of document.warnings) {
      findings.push({ severity: "warning", rule: "vmt-parse", message: warning });
    }

    const roots = (args.materialsDirs ?? []).map((dir) => resolveInput(dir, ctx.config));
    const textures = vmtTextures(document).map((entry) => {
      let found: boolean | null = null;
      if (roots.length > 0) {
        found = roots.some(
          (root) =>
            existsSync(join(root, `${entry.texture}.vtf`)) ||
            existsSync(join(root, `${entry.texture}.vmt`)),
        );
        if (!found) {
          findings.push({
            severity: "warning",
            rule: "vmt-texture-missing",
            message: `${entry.key} names ${entry.texture}, which was not found under the material roots`,
          });
        }
      }
      return { ...entry, found };
    });

    let patchInfo: {
      include: string | null;
      resolved: string | null;
      exists: boolean | null;
      shader: string | null;
      baseTexture: string | null;
      note: string;
    } | null = null;
    if (patch) {
      const include = document.parameters.get("include") ?? null;
      if (include !== null) {
        if (roots.length === 0) {
          patchInfo = {
            include,
            resolved: null,
            exists: null,
            shader: null,
            baseTexture: null,
            note:
              "pass materialsDirs to resolve the include; a patch without its base is only " +
              "half a material",
          };
          findings.push({
            severity: "info",
            rule: "vmt-patch-unresolved",
            message: "the patch include was not resolved because no materialsDirs were given",
          });
        } else {
          const relative = include.replace(/\\/g, "/").replace(/^materials\//i, "");
          const candidate = /\.vmt$/i.test(relative) ? relative : `${relative}.vmt`;
          const resolved = roots.map((root) => join(root, candidate)).find(existsSync) ?? null;
          if (resolved === null) {
            patchInfo = {
              include,
              resolved: null,
              exists: false,
              shader: null,
              baseTexture: null,
              note: `${candidate} was not found under the material roots`,
            };
            findings.push({
              severity: "warning",
              rule: "vmt-patch-missing",
              message: `include names ${candidate}, which is not under the material roots`,
            });
          } else {
            try {
              const base = parseVmt(readFileSync(resolved, "utf8"), resolved);
              const baseTexture = base.parameters.get("$basetexture") ?? null;
              patchInfo = {
                include,
                resolved,
                exists: true,
                shader: base.shader,
                baseTexture,
                note:
                  base.shader.toLowerCase() === "patch"
                    ? "the include is itself a patch; its own include is the next link"
                    : "the included material was read; its $basetexture is reported",
              };
              if (baseTexture === null) {
                findings.push({
                  severity: "warning",
                  rule: "vmt-patch-base-no-texture",
                  message: `${resolved} has no $basetexture, so the patch changes nothing visible`,
                });
              }
            } catch (error) {
              patchInfo = {
                include,
                resolved,
                exists: true,
                shader: null,
                baseTexture: null,
                note: error instanceof Error ? error.message : String(error),
              };
              findings.push({
                severity: "warning",
                rule: "vmt-patch-base",
                message: `${resolved} could not be read as a material`,
              });
            }
          }
        }
      }
    }

    const counts = {
      error: findings.filter((finding) => finding.severity === "error").length,
      warning: findings.filter((finding) => finding.severity === "warning").length,
      info: findings.filter((finding) => finding.severity === "info").length,
    };
    return {
      path,
      shader,
      overall: counts.error > 0 ? ("fail" as const) : counts.warning > 0 ? ("warn" as const) : ("pass" as const),
      findings,
      counts,
      textures,
      patch: patchInfo,
    };
  },
});

export const vmtCheckTools = [checkVmtTool];
