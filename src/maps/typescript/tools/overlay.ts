import { z } from "zod";
import { readFileSync } from "node:fs";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { buildOverlay } from "../vmf/overlay.js";
import { resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { editVmf } from "./vmfedit.js";

const VEC3 = z.array(z.number()).length(3);

export const writeOverlay = defineTool({
  name: "write_overlay",
  description:
    "Puts an `info_overlay` decal on an existing brush face: road markings, blood, signage. " +
    "Takes the face's side id (as read_vmf_surfaces reports) and a point on that face; it " +
    "computes the basis normal/U/V, builds the four corners and adds the entity through " +
    "edit_vmf. The format is read from Valve's own styleguide VMFs. Guarded.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("The .vmf to add the overlay to."),
    sideId: z.number().int().describe("Side id of the target face (from read_vmf_surfaces/read_vmf)."),
    material: z.string().describe('Decal material, e.g. "decals/blood1" or "overlays/..."'),
    origin: VEC3.describe("A point on the face, in world coordinates."),
    width: z.number().positive().default(64).describe("Overlay width in units."),
    height: z.number().positive().default(64).describe("Overlay height in units."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    entityId: z.number().nullable(),
    material: z.string(),
    normal: VEC3,
    u: VEC3,
    v: VEC3,
    sideClass: z.string(),
    warnings: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const text = readFileSync(path, "utf8");
    const overlay = buildOverlay(text, {
      sideId: args.sideId,
      material: args.material,
      origin: args.origin as [number, number, number],
      width: args.width,
      height: args.height,
    });

    const warnings: string[] = [];
    if (!["worldspawn", "func_detail", "func_brush"].includes(overlay.sideClass)) {
      warnings.push(
        `the face belongs to ${overlay.sideClass}; an overlay is baked in world space and ` +
          `does not follow a moving brush`,
      );
    }
    if (!/^(decals|overlays)\//i.test(args.material)) {
      warnings.push(
        `"${args.material}" is not under decals/ or overlays/; most overlay materials live there`,
      );
    }

    const edit = (await editVmf.handler(
      {
        path,
        ops: [{ op: "add", keyvalues: overlay.keyvalues }],
        backup: false,
        dryRun: false,
        confirm: true,
      },
      ctx,
    )) as { outcomes: Array<{ ids: number[] }> };

    return {
      entityId: edit.outcomes[0]?.ids[0] ?? null,
      material: args.material,
      normal: overlay.normal,
      u: overlay.u,
      v: overlay.v,
      sideClass: overlay.sideClass,
      warnings,
    };
  },
});

export const overlayTools = [writeOverlay];
