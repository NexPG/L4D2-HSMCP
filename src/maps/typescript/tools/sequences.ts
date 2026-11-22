/**
 * What the user's own editor does when it compiles.
 *
 * `run_compile` runs vbsp, vvis and vrad with the flags this project chooses, which is right
 * for a clean build and wrong for reproducing what a mapper sees when they press F9. Hammer,
 * Hammer++ and Strata each keep their Run Map steps in a file; this reads it and says which
 * steps are enabled, what each one runs, and with which parameters.
 *
 * The format is `srctools.cmdseq`'s through the sidecar. Discovery of the four possible
 * locations stays here: it is a fact about Hammer's installation, not about the file.
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { candidateSequenceFiles, findSequenceFile } from "../compile/sequences.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";

const COMMAND = z.object({
  enabled: z.boolean(),
  special: z.number(),
  kind: z.enum([
    "run",
    "change-directory",
    "copy-file",
    "delete-file",
    "rename-file",
    "copy-file-if-exists",
  ]),
  executable: z.string().nullable(),
  run: z.string(),
  parameters: z.string(),
  ensureCheck: z.boolean(),
  ensureFile: z.string().nullable(),
  useProcessWindow: z.boolean(),
  noWait: z.boolean(),
});

/** Which compiler a command runs, from its executable name. */
function stageOf(run: string): "vbsp" | "vvis" | "vrad" | "bspzip" | "other" {
  const name = run.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (name.startsWith("vbsp")) return "vbsp";
  if (name.startsWith("vvis")) return "vvis";
  if (name.startsWith("vrad")) return "vrad";
  if (name.startsWith("bspzip")) return "bspzip";
  return "other";
}

interface CmdSeqReply {
  path: string;
  format: "cmdseq-binary" | "keyvalues";
  sequences: Array<{
    name: string;
    commands: Array<z.infer<typeof COMMAND>>;
  }>;
}

export const readCompileSequencesTool = defineTool({
  name: "read_compile_sequences",
  description:
    "Reads the editor's Run Map sequences: which steps are enabled, what each runs and with " +
    "which parameters. Understands the binary CmdSeq.wc (Worldcraft / Hammer 3.x / 4.x) and " +
    "the KeyValues form Hammer++ and Strata write, through `srctools.cmdseq`; special steps " +
    "are named (copy, delete, rename, change directory) rather than left as a magic number. " +
    "Pass `file` to read one directly, or let it find the file next to the configured editor. " +
    "This is how to tell whether run_compile builds what the mapper builds — a disabled Copy " +
    "File step or an extra -StaticPropLighting is invisible otherwise. Needs the Python " +
    "sidecar; discovery alone does not.",
  realm: "local",
  inputSchema: {
    file: z.string().optional().describe("Path to CmdSeq.wc or hammerplusplus_sequences.cfg."),
    exeDir: z
      .string()
      .optional()
      .describe("Directory of hammer.exe, when it is not the configured one."),
  },
  outputSchema: {
    found: z.boolean(),
    path: z.string().nullable(),
    format: z.enum(["cmdseq-binary", "keyvalues"]).nullable(),
    candidates: z.array(z.string()),
    detail: z.string(),
    sequences: z.array(
      z.object({
        name: z.string(),
        enabledCount: z.number(),
        commands: z.array(
          COMMAND.extend({
            stage: z.enum(["vbsp", "vvis", "vrad", "bspzip", "other"]),
          }),
        ),
      }),
    ),
  },
  handler: async (args, ctx) => {
    const candidates = args.exeDir
      ? candidateSequenceFiles(resolveInput(args.exeDir, ctx.config))
      : [
          ...(ctx.config.plusPlusBinDir ? candidateSequenceFiles(ctx.config.plusPlusBinDir) : []),
          ...(ctx.config.binDir ? candidateSequenceFiles(ctx.config.binDir) : []),
        ];

    const file = args.file
      ? resolveInput(args.file, ctx.config)
      : args.exeDir
        ? findSequenceFile(resolveInput(args.exeDir, ctx.config))
        : (candidates.find((candidate) => existsSync(candidate)) ?? null);

    if (file === null || !existsSync(file)) {
      return {
        found: false,
        path: null,
        format: null,
        candidates,
        detail:
          "No Run Map sequence file found. Start the editor once so it writes one, pass " +
          "`file`, or pass `exeDir` when the editor lives outside the configured game.",
        sequences: [],
      };
    }

    const loaded = await callSidecar<CmdSeqReply>("cmdseq_read", { path: file }, ctx.config, 60_000);
    return {
      found: true,
      path: loaded.path,
      format: loaded.format,
      candidates,
      detail:
        loaded.format === "cmdseq-binary"
          ? "binary CmdSeq.wc: read by srctools.cmdseq"
          : "KeyValues (Hammer++ or Strata): read by srctools.cmdseq",
      sequences: loaded.sequences.map((sequence) => ({
        name: sequence.name,
        enabledCount: sequence.commands.filter((command) => command.enabled).length,
        commands: sequence.commands.map((command) => ({
          ...command,
          stage: stageOf(command.executable ?? command.run),
        })),
      })),
    };
  },
});

export const sequencesTools = [readCompileSequencesTool];
