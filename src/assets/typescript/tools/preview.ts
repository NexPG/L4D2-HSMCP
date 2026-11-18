import { z } from "zod";
import { gameFor } from "../../../core/typescript/games/resolve.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { runHlmvTool } from "../../../hammer/typescript/tools/hlmv.js";
import { GAME } from "../../../core/typescript/tools/paths.js";

/**
 * One asset, as a picture.
 *
 * `read_asset_catalog` says what exists and `read_model_info` says how big it is. Neither
 * answers "what does it look like", and choosing a facade or a prop from a name is how a
 * map gets a metal sheet where it wanted plaster. This is the eye: a material's base
 * texture decoded from its VTF, or a model opened in the game's own HLMV and captured.
 */
export const previewAssetTool = defineTool({
  name: "preview_asset",
  description:
    "Returns a real image of one stock material or model, so the agent can look at the " +
    "asset instead of guessing from its name. Materials: reads the VMT, finds its " +
    "$basetexture VTF, decodes it and returns the largest mip over a checkerboard. Models: " +
    "opens the game's HLMV on the model and captures the viewport (needs the Authoring " +
    "Tools and an interactive desktop). Use it before choosing a texture for a wall, a " +
    "model for a building, or an escalator; a name is not a look. The result includes the " +
    "resolved VMT/VTF or the HLMV window path, so the choice can be traced.",
  realm: "map",
  inputSchema: {
    asset: z
      .string()
      .describe(
        "Material in VMF form (`BRICK/BRICK_EXT_01`), a VMT path, or a model path/name " +
          "(`models/props_unique/escalator01_left.mdl`).",
      ),
    kind: z
      .enum(["auto", "material", "model"])
      .default("auto")
      .describe("Defaults to model when the name looks like one, material otherwise."),
    maxSize: z
      .number()
      .int()
      .min(32)
      .max(1024)
      .default(512)
      .describe("Material preview's longest side, in pixels. The source mip is kept intact."),
    waitMs: z
      .number()
      .int()
      .min(500)
      .max(20_000)
      .default(4500)
      .describe("How long HLMV gets to open the model before the capture."),
    game: GAME,
  },
  outputSchema: {
    asset: z.string(),
    kind: z.enum(["material", "model"]),
    found: z.boolean(),
    /** Material: the resolved VMT and VTF. Model: the `.mdl` HLMV opened. */
    source: z.string().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    note: z.string(),
    error: z.string().nullable(),
    /** Present on success: a real image block. */
    previewPath: z.string().nullable(),
  },
  handler: async (args, ctx) => {
    const looksModel =
      /\.mdl$/i.test(args.asset) || /^models[\\/]/i.test(args.asset) || args.kind === "model";
    const kind = args.kind === "auto" ? (looksModel ? "model" : "material") : args.kind;
    const { game } = gameFor(ctx.config, args.game);

    if (kind === "model") {
      const model = args.asset.startsWith("models/") || args.asset.startsWith("models\\")
        ? args.asset
        : `models/${args.asset.replace(/\\/g, "/").replace(/^\/+/, "")}`;
      const result = (await runHlmvTool.handler(
        {
          model,
          screenshot: true,
          method: "screen",
          close: true,
          waitMs: args.waitMs,
          game: args.game,
          confirm: true,
        } as never,
        ctx,
      )) as {
        model: string;
        screenshotPath: string | null;
        screenshotWidth: number | null;
        screenshotHeight: number | null;
        closed: boolean;
        _image?: { data: string; mimeType: string };
      };
      return {
        asset: args.asset,
        kind: "model" as const,
        found: result.screenshotPath !== null,
        source: result.model,
        width: result.screenshotWidth,
        height: result.screenshotHeight,
        note:
          result.screenshotPath === null
            ? "HLMV did not produce a capture; check that the Authoring Tools are installed."
            : `HLMV viewport captured to ${result.screenshotPath}; the window was closed: ${result.closed}.`,
        error: result.screenshotPath === null ? "HLMV capture failed" : null,
        previewPath: result.screenshotPath,
        ...(result._image ? { _image: result._image } : {}),
      };
    }

    if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
    const r = (await callSidecar(
      "material_preview",
      {
        gameDir: game.gameDir,
        material: args.asset,
        maxSize: args.maxSize,
      },
      ctx.config,
      120_000,
    )) as {
      found?: boolean;
      vmt?: string;
      vtf?: string;
      width?: number;
      height?: number;
      previewWidth?: number;
      previewHeight?: number;
      pngBase64?: string;
      error?: string;
      note?: string;
    };
    if (!r.found || !r.pngBase64) {
      return {
        asset: args.asset,
        kind: "material" as const,
        found: false,
        source: r.vtf ?? r.vmt ?? null,
        width: r.width ?? null,
        height: r.height ?? null,
        note: r.note ?? "no preview was produced",
        error: r.error ?? "material not found or its VTF could not be decoded",
        previewPath: null,
      };
    }
    return {
      asset: args.asset,
      kind: "material" as const,
      found: true,
      source: r.vtf ?? r.vmt ?? null,
      width: r.previewWidth ?? r.width ?? null,
      height: r.previewHeight ?? r.height ?? null,
      note:
        r.note ??
        "Base texture of the VMT over a checkerboard; not a lit render of the face.",
      error: null,
      previewPath: null,
      _image: { data: r.pngBase64, mimeType: "image/png" },
    };
  },
});

export const previewTools = [previewAssetTool];
