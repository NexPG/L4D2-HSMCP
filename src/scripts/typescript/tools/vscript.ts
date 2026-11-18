import { z } from "zod";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput, resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { editVmf } from "../../../maps/typescript/tools/vmfedit.js";

function bracesBalanced(source: string): boolean {
  let depth = 0;
  for (const char of source) {
    if (char === "{") depth++;
    else if (char === "}") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Squirrel looks like Lua to a model that has written a lot of Lua: `local`, `end`, `--[[`.
 * L4D2 VScript is Squirrel, so those are real errors, not style.
 */
function squirrelWarnings(source: string): string[] {
  const warnings: string[] = [];
  if (/^\s*local\s+\w+/m.test(source)) {
    warnings.push("`local` is Lua; Squirrel declares with `local` only inside functions in some dialects — L4D2 uses plain assignment. Check the SDK examples.");
  }
  if (/^\s*end\s*$/m.test(source)) {
    warnings.push("`end` is Lua; Squirrel closes blocks with `}`.");
  }
  if (/--\[\[/.test(source)) {
    warnings.push("`--[[ ]]` is Lua; Squirrel uses `/* */` for block comments.");
  }
  if (!/\b(printl|Msg|IncludeScript)\s*\(/.test(source)) {
    warnings.push(
      "No printl/Msg at the top: a script that fails to load leaves no evidence. Add a banner.",
    );
  }
  return warnings;
}

export const writeVscript = defineTool({
  name: "write_vscript",
  description:
    "Writes a Left 4 Dead 2 VScript (.nut) and optionally attaches it to a map. Checks the " +
    "file for the Lua habits that break Squirrel, for balanced braces, and for a load banner " +
    "that makes the script's execution provable in console.log. When `vmf` is given, adds a " +
    "logic_script entity with `vscripts` set to the file's base name (no extension), which " +
    "is how the engine finds it inside an add-on VPK. Guarded.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Where to write the .nut, for example <campaign>/addon/scripts/vscripts/finale.nut."),
    content: z.string().describe("The Squirrel source."),
    vmf: z
      .string()
      .optional()
      .describe("Optional .vmf to attach the script to; adds a logic_script entity."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    bytes: z.number(),
    attached: z.boolean(),
    vmf: z.string().nullable(),
    entityId: z.number().nullable(),
    warnings: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    // Validate a map path before touching anything else: a .vmf tool handed a .bsp has to
    // say "compiled map" and name a reader, not fail later inside the filesystem.
    if (args.vmf) resolveVmfInput(args.vmf, ctx.config);
    if (!args.path) throw new Error("path is required: where should the .nut be written?");
    if (extname(args.path).toLowerCase() !== ".nut") {
      throw new Error("a VScript file must end in .nut");
    }
    if (!bracesBalanced(args.content)) {
      throw new Error("unbalanced braces: the script will not compile");
    }
    const path = resolveInput(args.path, ctx.config);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, args.content, "utf8");

    const warnings = squirrelWarnings(args.content);
    let attached = false;
    let vmf: string | null = null;
    let entityId: number | null = null;

    if (args.vmf) {
      vmf = resolveVmfInput(args.vmf, ctx.config);
      const name = basename(path, ".nut");
      const edit = (await editVmf.handler(
        {
          path: vmf,
          ops: [
            {
              op: "add",
              keyvalues: {
                classname: "logic_script",
                origin: "0 0 64",
                vscripts: name,
              },
            },
          ],
          backup: false,
          dryRun: false,
          confirm: true,
        },
        ctx,
      )) as { outcomes: Array<{ ids: number[] }> };
      attached = true;
      entityId = edit.outcomes[0]?.ids[0] ?? null;
    }

    if (!existsSync(path)) throw new Error(`${path} was not written`);
    return { path, bytes: statSync(path).size, attached, vmf, entityId, warnings };
  },
});

export const vscriptTools = [writeVscript];
