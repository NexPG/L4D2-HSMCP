import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput, resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { editVmf } from "../../../maps/typescript/tools/vmfedit.js";
import { checkNut } from "../vscript/check.js";

const DIAGNOSTIC = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
  line: z.number().nullable(),
});

export const writeVscript = defineTool({
  name: "write_vscript",
  description:
    "Writes a Left 4 Dead 2 VScript (.nut) and optionally attaches it to a map. Checks the " +
    "source as Squirrel before writing: Lua habits (`end`, `elseif`, `nil`, `~=`, `--[[`) " +
    "are refused, braces/parentheses are balanced, the DirectorOptions custom-finale stage " +
    "list is checked for missing or extra stages, and a missing load banner is a warning. " +
    "When `vmf` is given, adds a logic_script entity with `vscripts` set to the file's base " +
    "name (no extension), which is how the engine finds it inside an add-on VPK. Guarded.",
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
    functions: z.array(z.string()),
    includes: z.array(z.string()),
    stageCount: z.number().nullable(),
    diagnostics: z.array(DIAGNOSTIC),
  },
  handler: async (args, ctx) => {
    // Validate a map path before touching anything else: a .vmf tool handed a .bsp has to
    // say "compiled map" and name a reader, not fail later inside the filesystem.
    if (args.vmf) resolveVmfInput(args.vmf, ctx.config);
    if (!args.path) throw new Error("path is required: where should the .nut be written?");
    if (extname(args.path).toLowerCase() !== ".nut") {
      throw new Error("a VScript file must end in .nut");
    }
    const path = resolveInput(args.path, ctx.config);
    const report = checkNut(args.content, path);
    const errors = report.diagnostics.filter((entry) => entry.severity === "error");
    if (errors.length > 0) {
      throw new Error(
        `the script would not compile:\n${errors
          .map((entry) => `${entry.line === null ? "" : `line ${entry.line}: `}${entry.message}`)
          .join("\n")}`,
      );
    }

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, args.content, "utf8");

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
    return {
      path,
      bytes: statSync(path).size,
      attached,
      vmf,
      entityId,
      warnings: report.diagnostics
        .filter((entry) => entry.severity !== "info")
        .map((entry) => `${entry.rule}: ${entry.message}`),
      functions: report.functions,
      includes: report.includes,
      stageCount: report.stageCount,
      diagnostics: report.diagnostics,
    };
  },
});

export const readVscriptTool = defineTool({
  name: "read_vscript",
  description:
    "Reads a .nut as Squirrel without running it: functions, IncludeScript targets, the " +
    "DirectorOptions table, the custom-finale stage list, whether a load banner exists, and " +
    "diagnostics. Errors are the Lua habits and unbalanced delimiters that stop the engine " +
    "compiling; a missing stage or a stage beyond A_CustomFinale_StageCount is an error or " +
    "warning; an unknown DirectorOptions key is information, because this checker does not " +
    "pretend to know every engine key. Use it before write_vscript or run_map_test.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .nut, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    ok: z.boolean(),
    functions: z.array(z.string()),
    includes: z.array(z.string()),
    directorOptions: z.record(z.string()),
    stageCount: z.number().nullable(),
    stages: z.array(z.object({ index: z.number(), type: z.string(), value: z.string().nullable() })),
    hasBanner: z.boolean(),
    diagnostics: z.array(DIAGNOSTIC),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    if (extname(path).toLowerCase() !== ".nut") throw new Error(`${path} is not a .nut`);
    return checkNut(readFileSync(path, "utf8"), path) as unknown as Record<string, unknown>;
  },
});

export const vscriptTools = [writeVscript, readVscriptTool];
