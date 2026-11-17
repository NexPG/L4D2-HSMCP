import { z } from "zod";
import { readFileSync } from "node:fs";
import { defineTool } from "../mcp/registry.js";
import { resolveVmfInput } from "./paths.js";
import { editVmf } from "./vmfedit.js";

const VEC3 = z.array(z.number()).length(3);

export const writeSkyCamera = defineTool({
  name: "write_sky_camera",
  description:
    "Places the single `sky_camera` a 3D skybox needs, with its origin, angles and scale. " +
    "The scale is how much the skybox geometry is shrunk (16 by default): the camera stays " +
    "at world scale and everything around it is 1/16 size. Warns when the map has no " +
    "`skyname` on worldspawn, and refuses a second sky_camera. Guarded.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("The .vmf."),
    origin: VEC3.describe("The sky camera origin, in world coordinates."),
    scale: z.number().int().min(1).max(64).default(16).describe("Skybox scale, Hammer's default is 16."),
    angles: z.string().default("0 0 0"),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    entityId: z.number().nullable(),
    scale: z.number(),
    warnings: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const text = readFileSync(path, "utf8");
    if (/"classname"\s+"sky_camera"/i.test(text)) {
      throw new Error("this map already has a sky_camera; a map has exactly one 3D skybox");
    }

    const warnings: string[] = [];
    const sky = /"skyname"\s+"([^"]*)"/i.exec(text);
    if (!sky || !sky[1]!.trim()) {
      warnings.push(
        "worldspawn has no skyname: a 3D skybox is drawn against the 2D sky, so set one " +
          "with set_map_properties first",
      );
    }

    const edit = (await editVmf.handler(
      {
        path,
        ops: [
          {
            op: "add",
            keyvalues: {
              classname: "sky_camera",
              origin: args.origin.join(" "),
              angles: args.angles,
              scale: String(args.scale),
            },
          },
        ],
        backup: false,
        dryRun: false,
        confirm: true,
      },
      ctx,
    )) as { outcomes: Array<{ ids: number[] }> };

    return {
      entityId: edit.outcomes[0]?.ids[0] ?? null,
      scale: args.scale,
      warnings,
    };
  },
});

export const skyboxTools = [writeSkyCamera];
