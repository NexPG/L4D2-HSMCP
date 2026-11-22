/**
 * What the user's own editor does when it compiles, and running those steps.
 *
 * `run_compile` runs vbsp, vvis and vrad with the flags this project chooses, which is right
 * for a clean build and wrong for reproducing what a mapper sees when they press F9. Hammer,
 * Hammer++ and Strata each keep their Run Map steps in a file; `read_compile_sequences` says
 * what is in it, and `run_compile_sequence` runs one sequence with the editor's own flags.
 *
 * The format is `srctools.cmdseq`'s through the sidecar. Discovery of the four possible
 * locations stays here: it is a fact about Hammer's installation, not about the file.
 *
 * ## What the runner will and will not do
 *
 * It runs the three compiler steps, the file steps (`Change Directory`, `Copy File`,
 * `Delete File`, `Rename File`, Strata's `Copy File if it Exists`) and the ensured-file
 * check. It does not launch the game: this server never talks to a running game, and a
 * `$game_exe` step is reported as skipped. It also refuses an executable that is not one of
 * the three compiler aliases, rather than executing an arbitrary path a config file names.
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { z } from "zod";
import { splitWindowsArgs } from "../compile/commandline.js";
import { parseCompileLog, stageClean } from "../compile/log.js";
import {
  type CmdSeqCommand,
  type SequenceVariables,
  findConfiguredSequenceFile,
  readSequenceFile,
  sequenceCandidates,
  substituteSequenceVariables,
} from "../compile/sequences.js";
import {
  type CompileStage,
  type Toolchain,
  TOOLCHAIN_ARG,
  ToolchainError,
  chooseToolchain,
  resolveCompiler,
  runCompiler,
  toolchainDir,
  toWindowsPath,
} from "../compile/toolchain.js";
import { applyCordon } from "../vmf/cordon.js";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { clip, defineTool } from "../../../core/typescript/mcp/registry.js";
import { GAME, GAME_BLOCK, resolveInput, resolveVmfInput } from "../../../core/typescript/tools/paths.js";

const CMDSEQ_KIND = z.enum([
  "run",
  "change-directory",
  "copy-file",
  "delete-file",
  "rename-file",
  "copy-file-if-exists",
]);

const COMMAND = z.object({
  enabled: z.boolean(),
  special: z.number(),
  kind: CMDSEQ_KIND,
  executable: z.string().nullable(),
  run: z.string(),
  parameters: z.string(),
  ensureCheck: z.boolean(),
  ensureFile: z.string().nullable(),
  useProcessWindow: z.boolean(),
  noWait: z.boolean(),
});

const FINDING = z.object({
  severity: z.string(),
  rule: z.string(),
  message: z.string(),
  line: z.string(),
});

const STAGE = z.enum(["vbsp", "vvis", "vrad", "bspzip", "other"]);

/** Which compiler a command runs, from its executable name. */
function stageOf(run: string): z.infer<typeof STAGE> {
  const alias = run.toLowerCase();
  if (alias === "$bsp_exe") return "vbsp";
  if (alias === "$vis_exe") return "vvis";
  if (alias === "$light_exe") return "vrad";
  const name = run.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (name.startsWith("vbsp")) return "vbsp";
  if (name.startsWith("vvis")) return "vvis";
  if (name.startsWith("vrad")) return "vrad";
  if (name.startsWith("bspzip")) return "bspzip";
  return "other";
}

/** The three compiler aliases and the stage each drives. Anything else is not a compiler. */
function compilerStage(alias: string): CompileStage | null {
  switch (alias.toLowerCase()) {
    case "$bsp_exe":
      return "vbsp";
    case "$vis_exe":
      return "vvis";
    case "$light_exe":
      return "vrad";
    default:
      return null;
  }
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
        commands: z.array(COMMAND.extend({ stage: STAGE })),
      }),
    ),
  },
  handler: async (args, ctx) => {
    const exeDir = args.exeDir ? resolveInput(args.exeDir, ctx.config) : undefined;
    const candidates = sequenceCandidates(ctx.config, exeDir);
    const file = args.file
      ? resolveInput(args.file, ctx.config)
      : findConfiguredSequenceFile(ctx.config, exeDir);

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

    const loaded = await readSequenceFile(ctx.config, file);
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

const RESOLVED = z.object({
  executable: z.string().nullable(),
  args: z.array(z.string()),
  source: z.string().nullable(),
  destination: z.string().nullable(),
  directory: z.string().nullable(),
});

const RUN_STATUS = z.enum(["planned", "ok", "failed", "skipped"]);

const RUN_COMMAND = z.object({
  index: z.number(),
  kind: CMDSEQ_KIND,
  stage: STAGE,
  special: z.number(),
  enabled: z.boolean(),
  run: z.string(),
  parameters: z.string(),
  resolved: RESOLVED,
  status: RUN_STATUS,
  exitCode: z.number().nullable(),
  durationMs: z.number().nullable(),
  findings: z.array(FINDING),
  clean: z.boolean().nullable(),
  stdoutTail: z.string(),
  ensureFile: z.string().nullable(),
  ensureSatisfied: z.boolean().nullable(),
  note: z.string().nullable(),
});

type RunStatus = z.infer<typeof RUN_STATUS>;
type Finding = z.infer<typeof FINDING>;

interface PlannedCommand {
  command: CmdSeqCommand;
  index: number;
  stage: z.infer<typeof STAGE>;
  status: RunStatus;
  resolved: z.infer<typeof RESOLVED>;
  compiler: { stage: CompileStage; exe: string } | null;
  ensureFile: string | null;
  exitCode: number | null;
  durationMs: number | null;
  findings: Finding[];
  clean: boolean | null;
  stdoutTail: string;
  ensureSatisfied: boolean | null;
  note: string | null;
}

/** A small helper so every plan starts with the same empty result fields. */
function planned(
  command: CmdSeqCommand,
  index: number,
  stage: z.infer<typeof STAGE>,
): PlannedCommand {
  return {
    command,
    index,
    stage,
    status: "skipped",
    resolved: { executable: null, args: [], source: null, destination: null, directory: null },
    compiler: null,
    ensureFile: null,
    exitCode: null,
    durationMs: null,
    findings: [],
    clean: null,
    stdoutTail: "",
    ensureSatisfied: null,
    note: null,
  };
}

function asOutput(plan: PlannedCommand): z.infer<typeof RUN_COMMAND> {
  return {
    index: plan.index,
    kind: plan.command.kind,
    stage: plan.stage,
    special: plan.command.special,
    enabled: plan.command.enabled,
    run: plan.command.run,
    parameters: plan.command.parameters,
    resolved: plan.resolved,
    status: plan.status,
    exitCode: plan.exitCode,
    durationMs: plan.durationMs,
    findings: plan.findings,
    clean: plan.clean,
    stdoutTail: plan.stdoutTail,
    ensureFile: plan.ensureFile,
    ensureSatisfied: plan.ensureSatisfied,
    note: plan.note,
  };
}

function native(path: string): string {
  return path.replace(/\//g, "\\");
}

export const runCompileSequenceTool = defineTool({
  name: "run_compile_sequence",
  description:
    "Runs one of the editor's Run Map sequences with the editor's own flags, resolving " +
    "`$path`, `$file`, `$gamedir`, `$bspdir`, `$bsp_exe`, `$vis_exe` and `$light_exe` the way " +
    "Hammer does. This is the faithful counterpart to run_compile when the mapper's custom " +
    "vrad flags or Copy File step are the point. Runs the three compilers and the file steps; " +
    "does NOT launch the game (`$game_exe` is reported skipped) and refuses an executable " +
    "that is not a compiler alias. `func_instance` maps are refused because vbsp crashes on " +
    "them and run_compile expands them. `dryRun: true` resolves and checks every step without " +
    "touching the disk. Needs the Python sidecar.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    vmf: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    sequence: z.string().describe("Sequence name, exactly as read_compile_sequences lists it."),
    file: z
      .string()
      .optional()
      .describe("Sequence file to use instead of the one next to the configured editor."),
    exeDir: z
      .string()
      .optional()
      .describe("Directory of hammer.exe, when it is not the configured one."),
    toolchain: TOOLCHAIN_ARG,
    game: GAME,
    timeoutMinutes: z
      .number()
      .int()
      .min(1)
      .max(600)
      .default(60)
      .describe("Per-command timeout. vvis on a large map is the slow step."),
    dryRun: z
      .boolean()
      .default(false)
      .describe(
        "Resolve variables, check the sequence and report every step without running or " +
          "writing anything. The default is to execute.",
      ),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    vmf: z.string(),
    sequence: z.string(),
    file: z.string(),
    format: z.enum(["cmdseq-binary", "keyvalues"]),
    toolchain: z.string(),
    toolchainRequested: z.string(),
    toolchainNote: z.string().nullable(),
    game: GAME_BLOCK,
    dryRun: z.boolean(),
    /** Every enabled step ran (or would run, in a dry run) and passed. */
    complete: z.boolean(),
    /** Nothing failed. A deliberately skipped game launch does not make this false. */
    ok: z.boolean(),
    stoppedAt: z.number().nullable(),
    commands: z.array(RUN_COMMAND),
    bsp: z.string(),
    bspExists: z.boolean(),
    bspBytes: z.number().nullable(),
    notes: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const vmf = resolveVmfInput(args.vmf, ctx.config);
    if (!existsSync(vmf)) throw new Error(`${vmf} does not exist`);
    if (extname(vmf).toLowerCase() !== ".vmf") throw new Error(`${vmf} is not a .vmf`);

    const bsp = join(dirname(vmf), `${basename(vmf, ".vmf")}.bsp`);
    assertWritable(bsp, ctx.config);

    const { game: profile, from } = gameFor(ctx.config, args.game);
    if (profile.unusableForCompile) {
      throw new ToolchainError(`cannot compile against ${profile.id}: ${profile.unusableForCompile}`);
    }
    const gameDir = profile.gameDir ?? ctx.config.gameDir;
    if (!gameDir) {
      throw new ToolchainError(`cannot compile against ${profile.id}: no -game directory was resolved`);
    }

    const exeDir = args.exeDir ? resolveInput(args.exeDir, ctx.config) : undefined;
    const file = args.file
      ? resolveInput(args.file, ctx.config)
      : findConfiguredSequenceFile(ctx.config, exeDir);
    if (file === null || !existsSync(file)) {
      throw new Error(
        "No Run Map sequence file found. Call read_compile_sequences to see the candidates, " +
          "pass `file`, or start the editor once so it writes one.",
      );
    }

    const loaded = await readSequenceFile(ctx.config, file);
    const sequence =
      loaded.sequences.find((candidate) => candidate.name === args.sequence) ??
      loaded.sequences.find(
        (candidate) => candidate.name.toLowerCase() === args.sequence.toLowerCase(),
      );
    if (!sequence) {
      throw new Error(
        `sequence "${args.sequence}" is not in ${file}. Available: ` +
          loaded.sequences.map((candidate) => candidate.name).join(", "),
      );
    }

    const stages = new Set<CompileStage>();
    for (const command of sequence.commands) {
      if (!command.enabled || command.kind !== "run" || command.executable === null) continue;
      const stage = compilerStage(command.executable);
      if (stage) stages.add(stage);
    }
    // A direct handler call (tests, scripts) does not pass input through zod, so a default
    // declared in the schema is absent here. Apply the same default explicitly.
    const requestedToolchain: Toolchain = args.toolchain ?? "plusplus";
    const chosen = chooseToolchain(ctx.config, requestedToolchain, [...stages], profile);
    const compilerDir = toolchainDir(ctx.config, chosen.chain, profile);
    if (stages.size > 0 && compilerDir === null) {
      throw new ToolchainError(
        `no directory is configured for the ${chosen.chain} compilers, so ${sequence.name} ` +
          `cannot resolve $bsp_exe/$vis_exe/$light_exe. Run health to see what discovery found.`,
      );
    }

    const variables: SequenceVariables = {
      path: toWindowsPath(dirname(vmf)),
      file: basename(vmf, ".vmf"),
      gamedir: toWindowsPath(gameDir),
      bspdir: native(join(gameDir, "maps")),
      bsp_exe: native(join(compilerDir ?? "", resolveCompiler(compilerDir ?? "", "vbsp", chosen.chain))),
      vis_exe: native(join(compilerDir ?? "", resolveCompiler(compilerDir ?? "", "vvis", chosen.chain))),
      light_exe: native(join(compilerDir ?? "", resolveCompiler(compilerDir ?? "", "vrad", chosen.chain))),
      game_exe: native(join(profile.gameRoot ?? gameDir, "left4dead2.exe")),
    };
    // A plain record: `substituteSequenceVariables` looks names up case-insensitively and
    // must not see the sequence's TypeScript-only fields.
    const variableMap: Record<string, string> = { ...variables };

    const vmfText = readFileSync(vmf, "utf8");
    const hasInstances = /"classname"\s+"func_instance"/i.test(vmfText);
    const notes: string[] = [];
    if (chosen.note) notes.push(chosen.note);

    try {
      if (applyCordon(vmfText, { ignore: true }).active) {
        notes.push(
          "the map has an active cordon. This runs the sequence against the source map, so " +
            "the cordon is not applied. run_compile applies it the way Hammer does.",
        );
      }
    } catch {
      // A cordon block this cannot read is not a reason to refuse the editor's own sequence.
    }

    const errors: string[] = [];
    const plans: PlannedCommand[] = [];
    let cwd = dirname(vmf);
    let usesBspDir = false;

    const substitute = (text: string, where: string): string => {
      const result = substituteSequenceVariables(text, variableMap);
      if (result.unknown.length > 0) {
        errors.push(`${where}: unknown ${result.unknown.join(", ")}`);
      }
      return result.text;
    };

    for (const [index, command] of sequence.commands.entries()) {
      const plan = planned(command, index, stageOf(command.executable ?? command.run));
      plans.push(plan);

      if (!command.enabled) {
        plan.note = "disabled in the editor";
        continue;
      }

      if (command.kind === "run") {
        if (command.executable === null) {
          errors.push(`command ${index + 1}: a Run step has no executable`);
          continue;
        }
        const stage = compilerStage(command.executable);
        const argv = splitWindowsArgs(command.parameters).map((token) =>
          substitute(token, `command ${index + 1}`),
        );
        plan.resolved.args = argv;
        plan.resolved.directory = compilerDir;

        if (stage !== null) {
          if (stage === "vbsp" && hasInstances) {
            errors.push(
              "command " +
                `${index + 1}: this map contains func_instance entities, which vbsp cannot ` +
                "expand (it crashes). run_compile expands them first; use that for this map.",
            );
          }
          plan.stage = stage;
          plan.compiler = {
            stage,
            exe: resolveCompiler(compilerDir as string, stage, chosen.chain),
          };
          plan.resolved.executable = variables[
            stage === "vbsp" ? "bsp_exe" : stage === "vvis" ? "vis_exe" : "light_exe"
          ];
          plan.status = "planned";
        } else if (command.executable.toLowerCase() === "$game_exe") {
          plan.resolved.executable = variables.game_exe;
          plan.status = "skipped";
          plan.note =
            "the server does not launch the game. The map is built; start Left 4 Dead 2 " +
            "yourself when you want to play it.";
        } else {
          plan.resolved.executable = command.executable;
          plan.status = "skipped";
          plan.note =
            "not a compiler alias ($bsp_exe, $vis_exe, $light_exe). This tool refuses to " +
            "execute an arbitrary path named by a config file.";
        }
      } else {
        const argv = splitWindowsArgs(command.parameters).map((token) =>
          substitute(token, `command ${index + 1}`),
        );
        plan.resolved.args = argv;
        plan.resolved.directory = cwd;

        if (command.kind === "change-directory") {
          if (argv.length !== 1) {
            errors.push(`command ${index + 1}: Change Directory needs one path, got ${argv.length}`);
          } else {
            const directory = resolve(cwd, argv[0]!);
            cwd = directory;
            plan.resolved.directory = directory;
            plan.status = "planned";
          }
        } else if (command.kind === "delete-file") {
          if (argv.length !== 1) {
            errors.push(`command ${index + 1}: Delete File needs one path, got ${argv.length}`);
          } else {
            plan.resolved.source = resolve(cwd, argv[0]!);
            plan.status = "planned";
          }
        } else {
          if (argv.length !== 2) {
            errors.push(
              `command ${index + 1}: ${command.run} needs a source and a destination, ` +
                `got ${argv.length} argument(s)`,
            );
          } else {
            plan.resolved.source = resolve(cwd, argv[0]!);
            plan.resolved.destination = resolve(cwd, argv[1]!);
            plan.status = "planned";
            if (command.parameters.toLowerCase().includes("$bspdir")) usesBspDir = true;
          }
        }
      }

      if (command.ensureCheck && command.ensureFile) {
        const ensured = substitute(command.ensureFile, `command ${index + 1} ensure_check`);
        plan.ensureFile = resolve(cwd, ensured);
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `cannot run sequence "${sequence.name}" from ${file}:\n- ${errors.join("\n- ")}`,
      );
    }

    if (usesBspDir) {
      notes.push(
        "$bspdir was resolved to <gameDir>/maps. Hammer++ stores its own BSPDir in " +
          "hammerplusplus_gameconfig.txt; if it points elsewhere, pass a sequence file " +
          "whose Copy File step names that directory.",
      );
    }

    if (args.dryRun) {
      notes.unshift("dry run: every step was resolved and checked, but nothing was run.");
    } else {
      if (args.confirm !== true) {
        throw new Error(
          `refusing to run sequence "${sequence.name}" without confirm: true. ` +
            `Pass dryRun: true to see the resolved steps first.`,
        );
      }
      const timeoutMinutes = args.timeoutMinutes ?? 60;
      const timeoutMs = timeoutMinutes * 60_000;
      let stoppedAt: number | null = null;

      for (const plan of plans) {
        if (plan.status !== "planned") continue;
        try {
          if (plan.command.kind === "change-directory") {
            plan.status = "ok";
          } else if (plan.compiler !== null) {
            ctx.audit.record({
              kind: "compile_start",
              data: {
                stage: plan.compiler.stage,
                vmf,
                toolchain: chosen.chain,
                sequence: sequence.name,
              },
            });
            const run = await runCompiler(
              ctx.config,
              plan.compiler.exe,
              plan.resolved.args,
              timeoutMs,
              chosen.chain,
              profile,
            );
            const report = parseCompileLog(`${run.stdout}\n${run.stderr}`);
            plan.exitCode = run.code;
            plan.durationMs = run.durationMs;
            plan.findings = report.findings;
            plan.clean = stageClean(report, run.code, run.timedOut);
            plan.stdoutTail = clip(run.stdout.split(/\r?\n/).slice(-40).join("\n"), 4000);
            plan.status = plan.clean ? "ok" : "failed";
            if (run.timedOut) plan.note = `timed out after ${timeoutMinutes} minute(s)`;
            ctx.audit.record({
              kind: "compile_end",
              data: {
                stage: plan.compiler.stage,
                toolchain: chosen.chain,
                exitCode: run.code,
                clean: plan.clean,
                ms: run.durationMs,
                sequence: sequence.name,
              },
            });
          } else if (plan.command.kind === "copy-file" || plan.command.kind === "copy-file-if-exists") {
            const source = plan.resolved.source as string;
            const destination = plan.resolved.destination as string;
            if (plan.command.kind === "copy-file-if-exists" && !existsSync(source)) {
              plan.status = "skipped";
              plan.note = `${source} does not exist, so the conditional copy did nothing`;
            } else {
              assertWritable(destination, ctx.config);
              copyFileSync(source, destination);
              ctx.audit.record({
                kind: "file_write",
                data: { path: destination, action: "copy", source },
              });
              plan.status = "ok";
            }
          } else if (plan.command.kind === "delete-file") {
            const source = plan.resolved.source as string;
            assertWritable(source, ctx.config);
            const existed = existsSync(source);
            rmSync(source, { force: true });
            ctx.audit.record({
              kind: "file_write",
              data: { path: source, action: "delete", existed },
            });
            plan.status = "ok";
            if (!existed) plan.note = `${source} was already absent`;
          } else if (plan.command.kind === "rename-file") {
            const source = plan.resolved.source as string;
            const destination = plan.resolved.destination as string;
            assertWritable(destination, ctx.config);
            assertWritable(source, ctx.config);
            renameSync(source, destination);
            ctx.audit.record({
              kind: "file_write",
              data: { path: destination, action: "rename", source },
            });
            plan.status = "ok";
          } else {
            plan.status = "failed";
            plan.note = `no runner for ${plan.command.kind}`;
          }
        } catch (error) {
          plan.status = "failed";
          plan.note = error instanceof Error ? error.message : String(error);
        }

        if (plan.status === "ok" && plan.ensureFile !== null) {
          plan.ensureSatisfied = existsSync(plan.ensureFile);
          if (!plan.ensureSatisfied) {
            plan.status = "failed";
            plan.note = `ensure_check failed: ${plan.ensureFile} does not exist after the step`;
          }
        }

        if (plan.status === "failed") {
          stoppedAt = plan.index;
          break;
        }
      }

      const complete = plans.every((plan) => !plan.command.enabled || plan.status === "ok");
      const ok = stoppedAt === null;
      const bspExists = existsSync(bsp);
      return {
        vmf,
        sequence: sequence.name,
        file,
        format: loaded.format,
        toolchain: chosen.chain,
        toolchainRequested: chosen.requested,
        toolchainNote: chosen.note,
        game: gameBlock(profile, from),
        dryRun: false,
        complete,
        ok,
        stoppedAt,
        commands: plans.map(asOutput),
        bsp,
        bspExists,
        bspBytes: bspExists ? statSync(bsp).size : null,
        notes,
      };
    }

    const complete = plans.every(
      (plan) => !plan.command.enabled || plan.status === "planned" || plan.status === "ok",
    );
    const bspExists = existsSync(bsp);
    return {
      vmf,
      sequence: sequence.name,
      file,
      format: loaded.format,
      toolchain: chosen.chain,
      toolchainRequested: chosen.requested,
      toolchainNote: chosen.note,
      game: gameBlock(profile, from),
      dryRun: true,
      complete,
      ok: true,
      stoppedAt: null,
      commands: plans.map(asOutput),
      bsp,
      bspExists,
      bspBytes: bspExists ? statSync(bsp).size : null,
      notes,
    };
  },
});

export const sequencesTools = [readCompileSequencesTool, runCompileSequenceTool];
