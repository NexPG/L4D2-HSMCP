/**
 * Loading screen / map thumbnail: a PNG becomes the VTF and the UnlitGeneric VMT the UI
 * loads. A campaign poster is referenced from the mission file's `posterImage`, which is the
 * material path without `materials/` or `.vmt`.
 */
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { writeVtfTool } from "./vtfgen.js";
import { writeVmtTool } from "./vmt.js";

function materialPath(outDir: string, name: string): string {
  const normal = outDir.replace(/\\/g, "/");
  const at = normal.toLowerCase().lastIndexOf("/materials/");
  if (at >= 0) return `${normal.slice(at + "/materials/".length)}/${name}`;
  if (normal.toLowerCase().endsWith("/materials")) return name;
  return name;
}

export const writeLoadingScreenTool = defineTool({
  name: "write_loading_screen",
  description:
    "Turns a PNG into a UI material pair: a `.vtf` and an `UnlitGeneric` `.vmt` under the " +
    "given `materials` directory. A campaign loading poster is 1024x1024, a map thumbnail " +
    "256x128; both are named by the mission's `posterImage` / map name without the " +
    "`materials/` prefix or `.vmt` extension. The VMT is written with `$translucent 1` for a " +
    "poster with alpha. The PNG is converted by the native `write_vtf` writer, so VTFCmd is " +
    "not needed. Guarded.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    image: z.string().describe("Source .png, absolute or relative to the repo root."),
    outDir: z
      .string()
      .describe(
        "Material directory, e.g. `<addon>/materials/vgui` for a campaign poster or " +
          "`<addon>/materials/vgui/maps` for a chapter thumbnail.",
      ),
    name: z
      .string()
      .min(1)
      .describe("Material name without extension, e.g. `LoadingScreen_MyCampaign` or `c1m1_hotel`."),
    translucent: z.boolean().default(true).describe("Write `$translucent 1`."),
    overwrite: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    image: z.string(),
    vtf: z.string(),
    vmt: z.string(),
    materialPath: z.string(),
    width: z.number(),
    height: z.number(),
    format: z.string(),
    written: z.boolean(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const image = resolveInput(args.image, ctx.config);
    if (!existsSync(image)) throw new Error(`${image} does not exist`);
    if (extname(image).toLowerCase() !== ".png") {
      throw new Error("write_vtf reads PNG; convert the image to a .png first");
    }
    if (/\s/.test(args.name) || args.name.includes("/") || args.name.includes("\\")) {
      throw new Error("the material name cannot contain spaces or path separators");
    }
    const outDir = resolveInput(args.outDir, ctx.config);
    const vtfPath = join(outDir, `${args.name}.vtf`);
    const vmtPath = join(outDir, `${args.name}.vmt`);
    const warnings: string[] = [];
    if (existsSync(vtfPath) && args.overwrite !== true) {
      throw new Error(`${vtfPath} already exists; pass overwrite: true`);
    }

    const vtf = (await writeVtfTool.handler(
      {
        image,
        path: vtfPath,
        format: args.translucent === false ? "DXT1" : "DXT5",
        version: "7.4",
        clampS: false,
        clampT: false,
        resize: "nearest",
        overwrite: args.overwrite === true,
        confirm: true,
      } as never,
      ctx as never,
    )) as { path: string; width: number; height: number; format: string; written: boolean };

    const material = materialPath(outDir, args.name);
    const values: Record<string, string> = { $basetexture: material };
    if (args.translucent !== false) values.$translucent = "1";
    const vmt = (await writeVmtTool.handler(
      {
        path: vmtPath,
        shader: "UnlitGeneric",
        values,
        overwrite: args.overwrite === true,
        confirm: true,
      } as never,
      ctx as never,
    )) as { path: string; written: boolean };

    if (vtf.width !== vtf.height && args.name.toLowerCase().startsWith("loadingscreen")) {
      warnings.push(
        `a loading poster is normally 1024x1024; this one is ${vtf.width}x${vtf.height}`,
      );
    }
    return {
      image,
      vtf: vtf.path,
      vmt: vmt.path,
      materialPath: material,
      width: vtf.width,
      height: vtf.height,
      format: vtf.format,
      written: vtf.written || vmt.written,
      warnings,
      nextStep:
        "Put the material path in the mission's poster.posterImage (campaign) or name the " +
        "thumbnail after the map (chapters), then pack the materials tree.",
    };
  },
});

export const loadingScreenTools = [writeLoadingScreenTool];
