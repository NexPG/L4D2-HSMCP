import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { clip } from "@projectsociety/mcp-core";
import { z } from "zod";
import { parseCompileLog, stageClean } from "../compile/log.js";
import { locateLeak, readPointfile } from "../compile/leak.js";
import {
  ToolchainError,
  TOOLCHAIN_ARG as TOOLCHAIN,
  chooseToolchain,
  compilerExe,
  runCompiler,
  toWindowsPath,
} from "../compile/toolchain.js";
import { readEntityLump } from "../bsp/entities.js";
import { LUMP_PAKFILE, readHeader } from "../bsp/header.js";
import { addToPakfile, readPakfile } from "../bsp/pakwrite.js";
import { checkNavFreshness } from "../../../nav/typescript/bsp/nav.js";
import { parseEntityText } from "../bsp/entities.js";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { checkSkybox } from "../../../core/typescript/games/skybox.js";
import { applyCordon } from "../vmf/cordon.js";
import { GAME, GAME_BLOCK, resolveInput, resolveVmfInput } from "../../../core/typescript/tools/paths.js";

const FINDING = z.object({
  severity: z.string(),
  rule: z.string(),
  message: z.string(),
  line: z.string(),
});

/**
 * Hammer++ by default: it is the better compiler, and this project compiles with it.
 *
 * The chain used to default to `stock`, on the argument that the comparison between the two
 * is the only oracle for whether the faster one changed something it should not have. That
 * argument is still true and it is now served differently: the comparison is preserved by
 * every result naming the chain that actually ran, not by making the slower chain the one
 * everybody gets by accident.
 *
 * An absent `++` install falls back to stock and says so, rather than failing -- a default
 * that cannot run on a machine without Hammer++ would take CI and every fresh clone with it.
 * The schema and that reasoning live beside `Toolchain` in `../compile/toolchain.ts`.
 */

const STAGE_RESULT = z.object({
  stage: z.string(),
  exitCode: z.number().nullable(),
  durationMs: z.number(),
  timedOut: z.boolean(),
  findings: z.array(FINDING),
  clean: z.boolean(),
  stdoutTail: z.string(),
});

export const runCompile = defineTool({
  name: "run_compile",
  description:
    "Compiles a .vmf with vbsp, vvis and vrad natively, and returns each stage's " +
    "findings rather than its raw output. Takes minutes to hours: vvis on a large map " +
    "is the slow part, and -fast exists for iteration. Stops at the first stage that " +
    "fails, because vvis and vrad results are meaningless after a leak. Run " +
    "read_vmf_lint first -- it catches before the compile most of what makes one fail. " +
    "An active cordon is applied to the compile copy the way Hammer applies it; pass " +
    "ignoreCordon: true to compile the whole map anyway. `func_instance` entities are " +
    "expanded before vbsp, which crashes on one, and the result says how many.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    vmf: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    fast: z
      .boolean()
      .default(true)
      .describe("vvis -fast and vrad -fast: minutes instead of hours, dev quality only."),
    hdr: z
      .boolean()
      .default(true)
      .describe(
        "vrad -both: produce the HDR and the LDR lightmap set. On by default because L4D2 " +
          "renders HDR by default, and an LDR-only map whose sky ships only HDR faces draws " +
          "no sky at all. Pass false only for a deliberate LDR-only build.",
      ),
    allowMissingSkyFaces: z
      .boolean()
      .optional()
      .describe(
        "Compile even when worldspawn's skyname has no faces for the mode being built. The " +
          "result is a map with no sky (the engine draws whatever it loaded last); this " +
          "exists for diagnosing an old map, not for shipping.",
      ),
    stages: z
      .array(z.enum(["vbsp", "vvis", "vrad"]))
      .default(["vbsp", "vvis", "vrad"])
      .describe("Stages to run, in order. vbsp alone is enough to check a map seals."),
    ignoreCordon: z
      .boolean()
      .optional()
      .describe(
        "Compile the whole map even when its cordon is switched on. By default an active " +
          "cordon filters the compile copy the way Hammer does: brushes outside the box and " +
          "entities whose origin is outside it are not handed to vbsp.",
      ),
    toolchain: TOOLCHAIN,
    cull: z
      .boolean()
      .optional()
      .describe(
        "Hammer++ only, and ON by default whenever the ++ chain runs. Culls unreferenced " +
          "planes, vertices, brushes and brush sides even when no limit is reached yet. " +
          "Measured on ttt_traps: -20.5% PLANES, -12.8% VERTEXES, -10.5% file size, with " +
          "FACES and TEXINFO unchanged -- which is what distinguishes a prune from a broken " +
          "map. Pass false to compile without it; read_map_geometry before and after is the " +
          "check. Passing true with toolchain 'stock' is refused rather than ignored.",
      ),
    game: GAME,
    timeoutMinutes: z.number().int().min(1).max(600).default(60),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    vmf: z.string(),
    /** The chain that actually ran, which is not always the one that was asked for. */
    toolchain: z.string(),
    /** What was asked for. Equal to `toolchain` unless the ++ chain was missing. */
    toolchainRequested: z.string(),
    /** Said whenever the two differ. A silent substitution would make a .bsp untraceable. */
    toolchainNote: z.string().nullable(),
    /** Whether the culling flags were passed. False on stock, where they do not exist. */
    cull: z.boolean(),
    /** `func_instance` expansion, done before vbsp because vbsp crashes on one. */
    instances: z.object({
      collapsed: z.number(),
      files: z.array(z.string()),
    }),
    game: GAME_BLOCK,
    bsp: z.string(),
    bspExists: z.boolean(),
    bspBytes: z.number().nullable(),
    stages: z.array(STAGE_RESULT),
    leaked: z.boolean(),
    pointfile: z.string().nullable(),
    /**
     * What the cordon did to the compile copy. `applied: false` with an active cordon means
     * `ignoreCordon` was set or no box had a volume.
     */
    cordon: z.object({
      active: z.boolean(),
      applied: z.boolean(),
      boxes: z.number(),
      removedSolids: z.number(),
      removedEntities: z.number(),
      note: z.string().nullable(),
    }),
    /** The sky check that ran before vbsp; `checked: false` means it could not run. */
    skybox: z.object({
      skyname: z.string().nullable(),
      checked: z.boolean(),
      found: z.boolean().nullable(),
      missingSides: z.array(z.string()),
      ldrComplete: z.boolean().nullable(),
      hdrComplete: z.boolean().nullable(),
      suggested: z.string(),
      alternatives: z.array(z.string()),
      note: z.string(),
    }),
    ok: z.boolean(),
  },
  handler: async (args, ctx) => {
    // Checked before anything touches the disk: this is an inconsistency between two
    // arguments, and it stays true whether or not the map exists. Only an *explicit* cull
    // is refused -- the default is now "on with the ++ chain", so leaving it out on a
    // stock compile has to mean "no culling" rather than an error.
    if (args.cull === true && args.toolchain !== "plusplus") {
      // Refused rather than dropped: the stock vbsp accepts unknown flags in silence, so
      // a stock compile with cull would report success and have culled nothing.
      throw new Error(`cull is a Hammer++ flag; pass toolchain: "plusplus" to use it`);
    }

    const vmf = resolveVmfInput(args.vmf, ctx.config);
    if (!existsSync(vmf)) throw new Error(`${vmf} does not exist`);
    if (extname(vmf).toLowerCase() !== ".vmf") throw new Error(`${vmf} is not a .vmf`);

    // The compilers write the .bsp beside the source, so that is a write we own.
    const bsp = join(dirname(vmf), `${basename(vmf, ".vmf")}.bsp`);
    assertWritable(bsp, ctx.config);

    const { game: profile, from } = gameFor(ctx.config, args.game);
    // Refused rather than attempted: a compile against a game whose toolchain we cannot
    // locate fails deeper down, with a message about a missing file.
    if (profile.unusableForCompile) {
      throw new ToolchainError(`cannot compile against ${profile.id}: ${profile.unusableForCompile}`);
    }
    const gameDir = profile.gameDir ?? ctx.config.gameDir;
    if (!gameDir) {
      throw new ToolchainError(
        `cannot compile against ${profile.id}: no -game directory was resolved`,
      );
    }
    const game = toWindowsPath(gameDir);
    const timeoutMs = args.timeoutMinutes * 60_000;

    // A sky is part of the compiled result, not of the editor view: vbsp writes the name
    // into worldspawn and the engine resolves six faces at load. A name with HDR faces only,
    // compiled LDR, produces "material skybox/<name>rt not found" and the map renders the
    // engine's fallback sky -- the bug that reads as "the skybox is broken". Check the mode
    // that vrad is about to write, before spending minutes on the compile.
    const vmfText = readFileSync(vmf, "utf8");
    const skyname = /"skyname"\s+"([^"]*)"/i.exec(vmfText)?.[1] ?? null;
    const skybox = skyname
      ? await checkSkybox(skyname, gameDir, ctx.config)
      : {
          checked: false,
          found: null,
          missingSides: [],
          ldrComplete: null,
          hdrComplete: null,
          suggested: "",
          alternatives: [],
          note:
            "worldspawn has no skyname. The engine will draw its fallback sky; set one " +
            "with write_vmf or set_worldspawn.",
        };
    const missingForMode =
      args.stages.includes("vrad") &&
      skybox.checked === true &&
      (skybox.found !== true ||
        skybox.ldrComplete !== true ||
        (args.hdr && skybox.hdrComplete !== true));
    if (missingForMode && args.allowMissingSkyFaces !== true) {
      throw new Error(
        `skybox/${skyname} is not a usable L4D2 sky for this build. ` +
          `L4D2 stores a mode-suffixed name in worldspawn (stock maps use \`_hdr\`) and ` +
          `asks for skybox/<skyname><side>.vmt. ` +
          (skybox.suggested && skybox.suggested !== skyname
            ? `Use \`${skybox.suggested}\`. `
            : `No \`_hdr\` or \`_ldr\` set with all six sides was found. `) +
          (skybox.alternatives.length > 0
            ? `Complete names in this game: ${skybox.alternatives.join(", ")}. `
            : ``) +
          `Pass allowMissingSkyFaces: true only to compile a known-broken map.`,
      );
    }

    // vbsp does not expand `func_instance`: handed one, it crashes with an access violation.
    // Hammer expands instances before the compile, and so does this, through the same
    // srctools pass `read_vmf` uses. The expanded copy goes into a temp directory under the
    // map's own name, because vbsp derives the map name from the file it is given.
    let tempDir: string | null = null;
    let compileText = vmfText;
    let instances: { collapsed: number; files: string[] } = { collapsed: 0, files: [] };
    if (/"classname"\s+"func_instance"/i.test(compileText)) {
      tempDir = mkdtempSync(join(tmpdir(), "hsmcp-compile-"));
      const out = join(tempDir, basename(vmf));
      try {
        const reply = (await callSidecar(
          "vmf_collapse",
          {
            path: vmf,
            out,
            gameDir: profile.gameDir ?? ctx.config.gameDir,
            instancePath: profile.instancePath,
          },
          ctx.config,
          120_000,
        )) as { collapsed: number; files: string[] };
        compileText = readFileSync(out, "utf8");
        instances = { collapsed: reply.collapsed, files: reply.files };
      } catch (error) {
        throw new Error(
          "this map contains func_instance entities, which vbsp cannot expand (it crashes). " +
            "Expanding them needs the Python sidecar: " +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    // The cordon is the one piece of the map's organisation that changes the compile: with
    // it on, Hammer hands vbsp only what the box contains. This used to read the block and
    // compile everything, so a one-room test built the whole map. It is applied after
    // instance expansion, so the instance geometry is inside the box that decides it.
    const cordon = applyCordon(compileText, { ignore: args.ignoreCordon });
    if (cordon.applied) compileText = cordon.text;

    let compileVmf = vmf;
    if (compileText !== vmfText) {
      if (!tempDir) tempDir = mkdtempSync(join(tmpdir(), "hsmcp-compile-"));
      compileVmf = join(tempDir, basename(vmf));
      writeFileSync(compileVmf, compileText);
    }
    const target = toWindowsPath(compileVmf);
    const compiledBsp = join(dirname(compileVmf), `${basename(compileVmf, ".vmf")}.bsp`);
    const compiledLin = join(dirname(compileVmf), `${basename(compileVmf, ".vmf")}.lin`);
    const realLin = join(dirname(vmf), `${basename(vmf, ".vmf")}.lin`);

    // Resolved against what is on disk, for the stages actually being run: asking for the
    // ++ chain on a machine that has none of it is a normal state, not a fault.
    const chosen = chooseToolchain(ctx.config, args.toolchain, args.stages, profile);
    const chain = chosen.chain;

    // On by default with the ++ chain, impossible without it. A fallback to stock takes
    // the flags with it, which is the whole reason the result reports `cull` separately.
    const culling = chain === "plusplus" && (args.cull ?? true);

    // The four go together: they cull the same way in four lumps, and read_map_geometry
    // reports each one separately, so nothing here is hidden behind a single number.
    const cull = culling
      ? ["-cullverts", "-cullplanes", "-cullbrushes", "-cullbrushsides"]
      : [];

    const plans: Record<string, { exe: string; argv: string[] }> = {
      vbsp: { exe: compilerExe("vbsp", chain), argv: [...cull, "-game", game, target] },
      vvis: {
        exe: compilerExe("vvis", chain),
        argv: [...(args.fast ? ["-fast"] : []), "-game", game, target],
      },
      vrad: {
        exe: compilerExe("vrad", chain),
        argv: [
          ...(args.fast ? ["-fast"] : []),
          ...(args.hdr ? ["-both"] : []),
          "-game",
          game,
          target,
        ],
      },
    };

    const stages: Array<z.infer<typeof STAGE_RESULT>> = [];
    let leaked = false;

    try {
      for (const stage of args.stages) {
        const plan = plans[stage]!;
        ctx.audit.record({ kind: "compile_start", data: { stage, vmf, toolchain: chain } });
        const run = await runCompiler(ctx.config, plan.exe, plan.argv, timeoutMs, chain, profile);
        const report = parseCompileLog(`${run.stdout}\n${run.stderr}`);
        ctx.audit.record({
          kind: "compile_end",
          data: {
            stage,
            toolchain: chain,
            exitCode: run.code,
            clean: stageClean(report, run.code, run.timedOut),
            ms: run.durationMs,
          },
        });

        stages.push({
          stage,
          exitCode: run.code,
          durationMs: run.durationMs,
          timedOut: run.timedOut,
          findings: report.findings,
          clean: stageClean(report, run.code, run.timedOut),
          stdoutTail: clip(run.stdout.split(/\r?\n/).slice(-40).join("\n"), 4000),
        });

        if (report.leaked) leaked = true;
        // Carrying on past a failed stage wastes an hour of vvis on a map that already
        // cannot produce meaningful visibility.
        if (!report.clean || run.timedOut) break;
      }

      // The compiler wrote beside the filtered copy, so the two artefacts a caller can read
      // afterwards are moved back under the map's real name. A stale `.lin` from an earlier
      // compile is removed when this one did not leak: read_leak must not report a leak the
      // current .bsp does not have.
      if (tempDir) {
        if (existsSync(compiledBsp)) copyFileSync(compiledBsp, bsp);
        if (existsSync(compiledLin)) copyFileSync(compiledLin, realLin);
        else rmSync(realLin, { force: true });
      }
    } finally {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    }

    const pointfile = realLin;
    const bspExists = existsSync(bsp);

    return {
      vmf,
      toolchain: chain,
      toolchainRequested: chosen.requested,
      toolchainNote: chosen.note,
      cull: culling,
      instances,
      game: gameBlock(profile, from),
      bsp,
      bspExists,
      bspBytes: bspExists ? statSync(bsp).size : null,
      stages,
      leaked,
      pointfile: existsSync(pointfile) ? pointfile : null,
      cordon: {
        active: cordon.active,
        applied: cordon.applied,
        boxes: cordon.boxes.length,
        removedSolids: cordon.removedSolids,
        removedEntities: cordon.removedEntities,
        note:
          cordon.warnings[0] ??
          (cordon.applied
            ? `${cordon.removedSolids} brush(es) and ${cordon.removedEntities} entit(ies) ` +
              `outside the cordon were left out of the compile`
            : null),
      },
      skybox: { skyname, ...skybox },
      ok: stages.every((s) => s.clean && !s.timedOut) && bspExists,
    };
  },
});

export const readCompileLog = defineTool({
  name: "read_compile_log",
  description:
    "Turns compiler output into structured findings, each with what the message actually " +
    "means. Use it on a log someone else produced, or on one from an editor. Several " +
    "Source messages name the wrong thing -- a leak gives no location, a displacement " +
    "error always prints brush id 0 -- so each finding carries the correction.",
  realm: "map",
  inputSchema: {
    text: z.string().describe("Raw compiler output."),
  },
  outputSchema: {
    findings: z.array(FINDING),
    bySeverity: z.record(z.number()),
    byRule: z.record(z.number()),
    clean: z.boolean(),
    leaked: z.boolean(),
  },
  handler: (args) => {
    const r = parseCompileLog(args.text);
    return {
      findings: r.findings,
      bySeverity: r.bySeverity,
      byRule: r.byRule,
      clean: r.clean,
      leaked: r.leaked,
    };
  },
});

export const readLeak = defineTool({
  name: "read_leak",
  description:
    "Turns a leak into a location. vbsp says only 'leaked!' and writes a .lin pointfile " +
    "beside the map: this reads it and names the entities nearest to where the path " +
    "starts, which is the entity that can see the void. Pass the .lin, or the .vmf or " +
    ".bsp beside it. Both ends of the path are correlated, because vbsp does not " +
    "guarantee which end holds the entity -- on a two-point pointfile it was the last. " +
    "No pointfile is an ANSWER, not an error: it returns leaked:false, and `compiled` " +
    "tells a map that did not leak from one nothing has compiled here. A .bsp that arrived " +
    "from somewhere else -- a Workshop .gma, a copy, a download -- carries no .lin and " +
    "never could, so `establishedBy` says whether the answer rests on evidence or on the " +
    "absence of a file that was never going to be there.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("The .lin pointfile, or the .vmf/.bsp it sits beside."),
    limit: z.number().int().min(1).max(50).default(5),
  },
  outputSchema: {
    pointfile: z.string(),
    /**
     * False when there is no pointfile, which is the answer and not a failure.
     *
     * This tool used to pass `readPointfile`'s throw straight through, so confirming that
     * a map was sealed came back as `read_leak failed: <map>.lin does not exist`. A caller
     * that treats a tool error as a broken step reads a sealed map as a broken step, and
     * one did, while building `hmcp_bodega` on 13/08/2026.
     */
    leaked: z.boolean(),
    /** Whether anything compiled this map here at all -- what tells the two no-leaks apart. */
    compiled: z.boolean(),
    /**
     * What the verdict rests on.
     *
     * `pointfile` -- vbsp wrote one and it was read. `compile-artefacts` -- no pointfile,
     * but a compile demonstrably happened in this directory, so its absence means
     * something. `nothing` -- neither, and the answer is not established.
     *
     * That third case is not hypothetical: the eastcoast audit read `leaked: false` off a
     * `.bsp` extracted from a Workshop `.gma`, where a `.lin` could not have existed. The
     * reasoning was sound for a map compiled in place and unsound for every other way of
     * obtaining one, and nothing in the reply said which case it was in.
     */
    establishedBy: z.enum(["pointfile", "compile-artefacts", "nothing"]),
    /** The sibling files the verdict was read from, by name. */
    evidence: z.array(z.string()),
    note: z.string(),
    pointCount: z.number().optional(),
    start: z.array(z.number()).optional(),
    end: z.array(z.number()).optional(),
    spanUnits: z.number().optional(),
    correlatedAgainst: z.string().nullable().optional(),
    nearestToStart: z.array(
      z.object({
        index: z.number(),
        id: z.number().optional(),
        classname: z.string(),
        targetname: z.string().optional(),
        origin: z.array(z.number()),
        distanceUnits: z.number(),
      }),
    ).optional(),
    nearestToEnd: z.array(
      z.object({
        index: z.number(),
        id: z.number().optional(),
        classname: z.string(),
        targetname: z.string().optional(),
        origin: z.array(z.number()),
        distanceUnits: z.number(),
      }),
    ).optional(),
    leakingEntity: z
      .object({
        index: z.number(),
        id: z.number().optional(),
        classname: z.string(),
        targetname: z.string().optional(),
        origin: z.array(z.number()),
        distanceUnits: z.number(),
        atEnd: z.boolean(),
      })
      .nullable()
      .optional(),
    points: z.array(z.object({ point: z.array(z.number()), index: z.number() })).optional(),
  },
  handler: async (args, ctx) => {
    const given = resolveInput(args.path, ctx.config);
    const stem = join(dirname(given), basename(given, extname(given)));
    const pointfile = extname(given).toLowerCase() === ".lin" ? given : `${stem}.lin`;
    const bsp = `${stem}.bsp`;
    const vmf = `${stem}.vmf`;

    // No pointfile is an answer, not a failure. vbsp writes one when it leaks and not
    // otherwise, so what is missing here is the leak -- and a caller asking "did this
    // leak?" should be told no, rather than handed an error to interpret.
    //
    // The .bsp is what removes the hedge this message used to carry. A compile that
    // produced a .bsp and no pointfile did not leak; nothing beside the map at all means
    // nothing has compiled it here, which is a different answer and used to read as the
    // same one.
    if (!existsSync(pointfile)) {
      const compiled = existsSync(bsp);
      // A .bsp alone is not evidence that a compile happened HERE. These are: the source
      // it was built from, the log vbsp wrote, the portal file vvis reads. A map that
      // arrived any other way has the .bsp and none of them.
      const artefacts = [vmf, `${stem}.log`, `${stem}.prt`].filter((f) => existsSync(f));
      const established = compiled && artefacts.length > 0;
      return {
        pointfile,
        leaked: false,
        compiled,
        establishedBy: established ? ("compile-artefacts" as const) : ("nothing" as const),
        evidence: established ? [bsp, ...artefacts] : compiled ? [bsp] : [],
        note: established
          ? `No pointfile beside this map, and ${bsp} is there together with ` +
            `${artefacts.map((f) => basename(f)).join(", ")}. vbsp writes a .lin when it ` +
            `leaks and does not otherwise, so the compile that produced that .bsp did not leak.`
          : compiled
            ? `${bsp} is here and nothing else is: no .vmf, no .log, no .prt. So nothing ` +
              `shows this map was compiled in this directory, and a .bsp obtained any other ` +
              `way -- extracted from a .gma, copied, downloaded -- never travels with its ` +
              `.lin. The missing pointfile therefore says nothing about this map. ` +
              `read_vmf_leak on the source answers it without a compiler; run_compile with ` +
              `stages ["vbsp"] answers it here.`
            : `No pointfile and no .bsp beside this map: nothing here has compiled it, so there ` +
              `is nothing to say about whether it leaks. run_compile with stages ["vbsp"] ` +
              `answers that, and read_vmf_leak answers it without a compiler at all.`,
        leakingEntity: null,
      };
    }

    const points = readPointfile(pointfile);

    // Entities come from whichever companion file exists: the .bsp if the map compiled
    // far enough to produce one, otherwise the .vmf through the sidecar.
    let entities;
    let correlatedAgainst: string | null = null;

    if (existsSync(bsp)) {
      entities = readEntityLump(bsp).entities;
      correlatedAgainst = bsp;
    } else if (existsSync(vmf)) {
      const reply = await callSidecar<{
        entities: Array<{
          id: number;
          classname: string;
          targetname: string | null;
          origin: number[] | null;
        }>;
      }>("vmf_read", { path: vmf, limit: 2000 }, ctx.config, 300_000);
      entities = reply.entities
        .filter((e) => e.origin)
        .map((e, i) => ({
          index: i,
          id: e.id,
          classname: e.classname,
          ...(e.targetname ? { targetname: e.targetname } : {}),
          origin: e.origin as [number, number, number],
          keyvalues: [],
          connections: [],
          solidCount: 0,
          start: 0,
          end: 0,
        }));
      correlatedAgainst = vmf;
    } else {
      entities = parseEntityText("");
    }

    return {
      ...locateLeak(pointfile, points, entities, args.limit),
      leaked: true,
      compiled: existsSync(bsp),
      establishedBy: "pointfile" as const,
      evidence: [pointfile],
      correlatedAgainst,
      note:
        `${pointfile} is there, so the last compile leaked. The path runs from an entity ` +
        `that can see the void to the void itself; leakingEntity is this toolkit's best ` +
        `guess at which end holds the entity, and both ends are reported because vbsp does ` +
        `not guarantee it.`,
    };
  },
});



export const runPack = defineTool({
  name: "run_pack",
  description:
    "Packs files into a compiled .bsp with this server's own ZIP writer: no bspzip, no " +
    "Steam install, no VConfig. Takes explicit pairs of in-game path and source file. With " +
    "auto:true it also derives the list from the map itself, via read_map_dependencies: " +
    "every asset the map references that resolves from a LOOSE file in the game's content " +
    "tree rather than from a VPK. Those are the ones that ship broken -- they work at home " +
    "because they are on that disk. VPK content is never packed: every player who owns the " +
    "game has it. The derived list is returned, so what was packed is visible rather than " +
    "inferred. Verifies afterwards by reading every entry back and comparing bytes; `ok` is " +
    "the archive's answer, not a process exit code. `toolchain` is accepted for " +
    "compatibility and reported as 'native'.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    bsp: z.string().describe("Target .bsp. It is rewritten in place."),
    files: z
      .array(
        z.object({
          internal: z
            .string()
            .describe("Path inside the map, e.g. materials/foo/bar.vmt."),
          source: z.string().describe("File on disk to pack."),
        }),
      )
      .optional()
      .describe("Explicit pairs. Required unless auto is set; combined with it otherwise."),
    auto: z
      .boolean()
      .optional()
      .describe(
        "Derive the list from the map: assets it references that sit loose in the game's " +
          "content tree rather than in a VPK. Needs the Python sidecar.",
      ),
    exclude: z
      .array(z.string())
      .optional()
      .describe(
        "Substrings of in-game paths auto should skip. For the occasional stock file that " +
          "ships loose -- Garry's Mod keeps detail.vbsp in its own root -- which auto " +
          "would otherwise pack harmlessly but pointlessly.",
      ),
    toolchain: TOOLCHAIN,
    backup: z
      .boolean()
      .optional()
      .describe("Write <bsp>.bak before the pakfile is replaced. On by default."),
    game: GAME,
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    bsp: z.string(),
    /** The chain that actually ran. bspzip++ packs with multi-threaded LZMA; stock does not. */
    toolchain: z.string(),
    toolchainRequested: z.string(),
    toolchainNote: z.string().nullable(),
    game: GAME_BLOCK,
    requested: z.number(),
    /** Pairs auto mode derived from the map, whether or not any were also given by hand. */
    derived: z.array(z.object({ internal: z.string(), source: z.string() })),
    autoNote: z.string().optional(),
    filesBefore: z.number(),
    filesAfter: z.number(),
    added: z.number(),
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    exitCode: z.number().nullable(),
    ok: z.boolean(),
    missingSources: z.array(z.string()),
    stdoutTail: z.string(),
  },
  handler: async (args, ctx) => {
    const { game: packProfile, from: packFrom } = gameFor(ctx.config, args.game);
    const bsp = assertWritable(resolveInput(args.bsp, ctx.config), ctx.config);
    if (!existsSync(bsp)) throw new Error(`${bsp} does not exist`);
    const packGameDir = packProfile.gameDir ?? ctx.config.gameDir;

    const derived: Array<{ internal: string; source: string }> = [];
    let autoNote: string | undefined;
    if (args.auto) {
      // Only the dependency walk needs a game directory. An explicit pack is a ZIP append
      // and needs nothing from the install at all.
      if (!packGameDir) {
        throw new ToolchainError(
          `cannot derive the file list for ${packProfile.id}: no -game directory was resolved`,
        );
      }
      const deps = await callSidecar<{
        loose: Array<{ path: string; diskPath: string | null }>;
        looseCount: number;
        missingCount: number;
      }>(
        "map_dependencies",
        {
          path: bsp,
          gameDir: packGameDir,
          limit: 5000,
        },
        ctx.config,
        600_000,
      );
      const excluded: string[] = [];
      for (const entry of deps.loose) {
        if (!entry.diskPath) continue;
        if ((args.exclude ?? []).some((pat) => entry.path.includes(pat))) {
          excluded.push(entry.path);
          continue;
        }
        derived.push({ internal: entry.path, source: entry.diskPath });
      }
      autoNote =
        `${deps.looseCount} asset(s) resolve from loose files in the game tree; ` +
        `${derived.length} packed here` +
        (excluded.length > 0 ? `, ${excluded.length} excluded by request` : "") +
        `. A loose file is a candidate, not a certainty -- some games ship stock files ` +
        `loose (Garry's Mod keeps detail.vbsp in its own root). Over-packing costs ` +
        `kilobytes; under-packing ships a broken map, so this errs toward including. ` +
        (deps.missingCount > 0
          ? `${deps.missingCount} more are missing from everywhere and CANNOT be packed -- ` +
            `read_map_dependencies lists them, and packing will not fix them.`
          : `Nothing the map references is missing outright.`);
    }

    // Explicit pairs win: a caller who named a source meant that one.
    const byInternal = new Map(derived.map((f) => [f.internal, f]));
    for (const f of args.files ?? []) byInternal.set(f.internal, f);
    const files = [...byInternal.values()];
    if (files.length === 0) {
      throw new Error(
        args.auto
          ? "auto found nothing to pack: no asset this map references sits loose in the " +
            "game tree. That is the healthy answer, not a failure."
          : "no files given, and auto is not set",
      );
    }

    const missingSources = files
      .map((f) => resolveInput(f.source, ctx.config))
      .filter((p) => !existsSync(p));
    if (missingSources.length > 0) {
      throw new Error(
        `cannot pack files that do not exist: ${missingSources.slice(0, 5).join(", ")}`,
      );
    }

    const inputs = files.map((file) => ({
      internal: file.internal,
      data: readFileSync(resolveInput(file.source, ctx.config)),
    }));

    // Packing is this server's own ZIP writer now. bspzip is a separate binary that needs a
    // Steam install and a VConfig setup, and its `-addlist` writes to a second file rather
    // than in place; none of that is required to append a ZIP. `run_pakfile_add` is the same
    // writer with explicit files only.
    const source = readFileSync(bsp);
    const header = readHeader(bsp);
    const lump = header.lumps[LUMP_PAKFILE]!;
    const target = { offset: lump.offset, length: lump.length, layout: header.layout };
    const filesBefore = readPakfile(source, target, bsp).length;
    const bytesBefore = source.length;

    if (args.backup !== false) {
      copyFileSync(bsp, `${bsp}.bak`);
    }
    const result = addToPakfile(source, inputs, target);
    writeFileSync(bsp, result.bytes);

    const bytes = readFileSync(bsp);
    const afterHeader = readHeader(bsp);
    const afterLump = afterHeader.lumps[LUMP_PAKFILE]!;
    const after = readPakfile(
      bytes,
      { offset: afterLump.offset, length: afterLump.length, layout: afterHeader.layout },
      bsp,
    );
    const byName = new Map(after.map((entry) => [entry.name.toLowerCase(), entry.data]));
    const verified = inputs.every((file) => {
      const stored = byName.get(file.internal.replace(/\\/g, "/").toLowerCase());
      return stored !== undefined && stored.equals(file.data);
    });

    const filesAfter = after.length;
    const bytesAfter = bytes.length;

    return {
      bsp,
      toolchain: "native",
      toolchainRequested: args.toolchain,
      toolchainNote: "packed by this server's ZIP writer; bspzip was not run",
      game: gameBlock(packProfile, packFrom),
      requested: files.length,
      derived,
      ...(autoNote !== undefined ? { autoNote } : {}),
      filesBefore,
      filesAfter,
      added: result.added.length,
      bytesBefore,
      bytesAfter,
      exitCode: null,
      // The oracle is the archive, not an exit code: every requested entry is read back
      // and compared byte for byte.
      ok: verified,
      missingSources,
      stdoutTail: "",
    };
  },
});

export const readNav = defineTool({
  name: "read_nav",
  description:
    "Reads a .nav mesh header and says whether it still matches its map. The engine " +
    "compares the BSP size recorded in the mesh against the map it is loading, and a " +
    "mismatch means the mesh is silently unusable -- in game that looks like Nextbots " +
    "that will not path, with nothing in the console explaining why. Recompiling a map " +
    "always invalidates its nav, so check this after any compile. Generating a new one " +
    "needs the engine (nav_generate); there is no offline generator, in this project or " +
    "anywhere public.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("The .nav, or the .bsp beside it."),
  },
  outputSchema: {
    path: z.string(),
    fileBytes: z.number(),
    version: z.number(),
    subVersion: z.number().nullable(),
    savedBspSize: z.number(),
    actualBspSize: z.number().nullable(),
    matchesBsp: z.boolean().nullable(),
    verdict: z.string(),
    isAnalyzed: z.boolean().nullable(),
    placeCount: z.number().nullable(),
    areaCount: z.number().nullable(),
    bsp: z.string().nullable(),
  },
  handler: (args, ctx) => {
    const given = resolveInput(args.path, ctx.config);
    const stem = join(dirname(given), basename(given, extname(given)));
    const nav = extname(given).toLowerCase() === ".nav" ? given : `${stem}.nav`;
    const bsp = `${stem}.bsp`;
    return { ...checkNavFreshness(nav, existsSync(bsp) ? bsp : null) };
  },
});

export const compileTools = [runCompile, readCompileLog, readLeak, runPack, readNav];

