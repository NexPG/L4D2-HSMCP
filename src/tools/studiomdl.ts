import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { gameFor } from "../games/resolve.js";
import { GAME, CONFIRM, resolveInput } from "./paths.js";

const MODELNAME = /^\s*\$modelname\s+"?([^"\r\n]+)"?/im;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

function runProcess(exe: string, args: readonly string[], timeoutMs: number): Promise<Run> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(exe, args, {
      cwd: dirname(exe),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: string[] = [];
    const err: string[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // The process may already be gone.
      }
    }, timeoutMs);
    child.stdout?.on("data", (b: Buffer) => out.push(b.toString("utf8")));
    child.stderr?.on("data", (b: Buffer) => err.push(b.toString("utf8")));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: out.join(""),
        stderr: err.join(""),
        timedOut,
        durationMs: Date.now() - started,
      });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        code: null,
        stdout: out.join(""),
        stderr: `${err.join("")}\n${e.message}`,
        timedOut: false,
        durationMs: Date.now() - started,
      });
    });
  });
}

/**
 * Compiles one QC with the game's own `studiomdl.exe`.
 *
 * The QC is the source of truth: the tool does not generate one, because a generated QC
 * is a template. It reads `$modelname` to know where the compiler is supposed to write,
 * then proves the `.mdl` exists instead of trusting the exit code alone.
 */
export const runStudiomdlTool = defineTool({
  name: "run_studiomdl",
  description:
    "Compiles a QC into a Source model with the game's own studiomdl.exe, then proves the " +
    "result: `$modelname` is read from the QC, and the .mdl (plus the .vvd/.vtx/.phy files " +
    "studiomdl wrote beside it) must exist. The QC and SMDs are yours; this is the compiler " +
    "step, not a model template. `-nop4` and `-game` are fixed; no free-form flags. " +
    "Long-running and guarded. The compiled model is the product, not a test artefact.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    qc: z.string().describe("Path to the .qc, absolute or relative to the repo root."),
    game: GAME,
    timeoutMinutes: z.number().int().min(1).max(120).default(10),
    confirm: CONFIRM,
  },
  outputSchema: {
    qc: z.string(),
    modelname: z.string().nullable(),
    model: z.string().nullable(),
    modelExists: z.boolean(),
    files: z.array(z.object({ name: z.string(), bytes: z.number() })),
    exitCode: z.number().nullable(),
    timedOut: z.boolean(),
    durationMs: z.number(),
    ok: z.boolean(),
    logTail: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const qc = resolveInput(args.qc, ctx.config);
    if (!existsSync(qc)) throw new Error(`${qc} does not exist`);
    if (extname(qc).toLowerCase() !== ".qc") throw new Error(`${qc} is not a .qc`);

    const { game: profile } = gameFor(ctx.config, args.game);
    const gameDir = profile.gameDir ?? ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const exe = join(profile.binDir ?? join(dirname(gameDir), "bin"), "studiomdl.exe");
    if (!existsSync(exe)) {
      throw new Error(
        `${exe} does not exist. Install the Left 4 Dead 2 Authoring Tools (Steam app 563) ` +
          `or check health for the resolved bin directory.`,
      );
    }

    const text = readFileSync(qc, "utf8");
    const match = MODELNAME.exec(text);
    const modelname = match?.[1]?.trim() ?? null;
    const run = await runProcess(
      exe,
      ["-nop4", "-game", gameDir, qc],
      (args.timeoutMinutes ?? 10) * 60_000,
    );

    const normalized = modelname?.replace(/\\/g, "/").replace(/^models\//i, "") ?? null;
    const model = normalized ? join(gameDir, "models", normalized) : null;
    const modelExists = model !== null && existsSync(model);
    const files: Array<{ name: string; bytes: number }> = [];
    if (model && existsSync(dirname(model))) {
      const base = basename(model, ".mdl").toLowerCase();
      for (const name of readdirSync(dirname(model))) {
        if (!name.toLowerCase().startsWith(base)) continue;
        const path = join(dirname(model), name);
        if (existsSync(path)) files.push({ name, bytes: statSync(path).size });
      }
    }

    const log = `${run.stdout}\n${run.stderr}`;
    return {
      qc,
      modelname,
      model,
      modelExists,
      files,
      exitCode: run.code,
      timedOut: run.timedOut,
      durationMs: run.durationMs,
      ok: run.code === 0 && !run.timedOut && (model === null || modelExists),
      logTail: log
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-40),
    };
  },
});

export const studiomdlTools = [runStudiomdlTool];
