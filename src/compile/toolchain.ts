import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "@projectsociety/mcp-core";
import type { RunResult } from "@projectsociety/mcp-core";
import type { Config } from "../config.js";
import type { ResolvedGame } from "../games/profile.js";

export class ToolchainError extends Error {}

/**
 * Normalises an absolute Windows path for the compilers.
 *
 * This fork runs on Windows only, so there is no `Z:` mapping and nothing to translate:
 * a drive path has its separators normalised, and anything else is refused. A relative
 * path is the dangerous case -- the compiler resolves it against its own working
 * directory and can compile a different file than the one asked for, silently.
 */
export function toWindowsPath(path: string): string {
  if (!/^[A-Za-z]:[\\/]/.test(path)) {
    throw new ToolchainError(
      `${path}: the Source compilers need an absolute Windows drive path, not a relative one`,
    );
  }
  return path.replace(/\//g, "\\");
}

export interface CompilerRun extends RunResult {
  command: string;
  args: string[];
  durationMs: number;
}

/**
 * Which set of compilers to drive.
 *
 * `stock` is what ships with the Left 4 Dead 2 client. `plusplus` is ficool2's rebuild of
 * the same tools -- same inputs, same outputs, faster and with extra flags -- and it is
 * the default this repository compiles with. Since October 2026 those binaries are
 * standalone: they live wherever they were unpacked, not inside the game's `bin/`.
 *
 * The two still coexist rather than replace each other, and that matters more now than it
 * did when stock was the default: comparing a `plusplus` result against the `stock` one on
 * the same source is the only oracle available for judging whether the faster chain
 * changed anything it should not have. Which is why every result says which chain ran.
 */
export type Toolchain = "stock" | "plusplus";

/** The compile stages, and the pack step, that both toolchains provide. */
export type CompileStage = "vbsp" | "vvis" | "vrad" | "bspzip";

/**
 * Where a toolchain's binaries live.
 *
 * `stock` comes from discovery: the game's own `bin/`, which is also where the `.fgd`
 * files are. `plusplus` comes from `gameProfiles.l4d2.plusPlusBinDir` (or the config-wide
 * `plusPlusBinDir`) because Tools++ is a standalone download with no discoverable home.
 *
 * Null means "this machine has no such directory", not "use some default": the `bin/win64`
 * fallback that used to live here was measured for Garry's Mod and is not a fact about
 * Left 4 Dead 2.
 */
export function toolchainDir(
  config: Config,
  chain: Toolchain,
  game?: ResolvedGame,
): string | null {
  if (chain === "stock") return game?.binDir ?? config.binDir;
  return game?.plusPlusBinDir ?? config.plusPlusBinDir;
}

/**
 * `vbsp.exe` or `vbsp++.exe`. One place knows the naming convention.
 *
 * The Tools++ download from October 2026 is standalone and names its binaries
 * `vbsp++.exe`; the older in-game builds were `vbspplusplus.exe`. Both are accepted --
 * the name is a fact about an install, not something to guess -- and every caller that
 * reads a directory goes through `compilerCandidates`.
 */
export function compilerExe(stage: CompileStage, chain: Toolchain): string {
  return chain === "stock" ? `${stage}.exe` : `${stage}++.exe`;
}

/** Every filename a stage may carry on the `++` chain, newest convention first. */
export function compilerCandidates(stage: CompileStage, chain: Toolchain): string[] {
  if (chain === "stock") return [`${stage}.exe`];
  return [`${stage}++.exe`, `${stage}plusplus.exe`];
}

/** The first candidate present in `dir`, or the canonical name when none is. */
export function resolveCompiler(dir: string, stage: CompileStage, chain: Toolchain): string {
  for (const name of compilerCandidates(stage, chain)) {
    if (existsSync(join(dir, name))) return name;
  }
  return compilerExe(stage, chain);
}

export interface ChosenToolchain {
  /** The chain that will actually run. */
  chain: Toolchain;
  /** The chain that was asked for, which is not always the one that runs. */
  requested: Toolchain;
  /** Binaries the requested chain is missing, named. Empty when nothing is missing. */
  missing: string[];
  /** Said out loud whenever `chain !== requested`, and null otherwise. */
  note: string | null;
}

/**
 * Which chain runs, given which one was asked for and what is installed.
 *
 * The `++` chain is the default because it is the better compiler -- vvis measured 50% to
 * 2700% faster by its author, and the culling flags exist only there. But a default that
 * cannot run on a machine without it would make this server useless on exactly the machines
 * that need it most, CI included. So an absent `++` chain **falls back to stock and says
 * so**, in the result and in a note, rather than either failing or quietly substituting.
 *
 * Silence was the option deliberately rejected: without `toolchainRequested` beside
 * `toolchain`, nobody could tell which compilers produced a given `.bsp`, and the comparison
 * between the two chains -- the only oracle for "did the fast one change something" -- would
 * stop being possible without anyone noticing.
 */
export function chooseToolchain(
  config: Config,
  requested: Toolchain,
  stages: readonly CompileStage[],
  game?: ResolvedGame,
): ChosenToolchain {
  const dir = toolchainDir(config, requested, game);
  const missing =
    dir === null
      ? stages.map((s) => compilerExe(s, requested))
      : stages
          .filter(
            (s) => !compilerCandidates(s, requested).some((n) => existsSync(join(dir, n))),
          )
          .map((s) => compilerExe(s, requested));

  if (missing.length === 0) return { chain: requested, requested, missing: [], note: null };
  if (requested === "stock") {
    // Nothing to fall back to, and the error runCompiler raises names the directory.
    return { chain: "stock", requested, missing, note: null };
  }

  return {
    chain: "stock",
    requested,
    missing,
    note:
      dir === null
        ? `The Tools++ chain is the default and no directory is configured for it ` +
          `(${missing.join(", ")} not found), so this ran on the stock compilers. Set ` +
          `gameProfiles.l4d2.plusPlusBinDir, or unpack Tools++ into externalToolsDir. ` +
          `The stock chain is unaffected; that is a slower vvis and no culling flags, not ` +
          `a different map.`
        : `The Tools++ chain is the default and is not installed here (${missing.join(", ")} ` +
          `missing from ${dir}), so this ran on the stock compilers. That is a slower vvis ` +
          `and no culling flags, not a different map. The four binaries come from ` +
          `tools++_windows.zip (ficool2/misc_tools); health reports which are present.`,
  };
}

/**
 * Runs one Source compiler natively.
 *
 * The working directory is load-bearing, measured rather than guessed: it must be the
 * compiler's own folder or `tier0.dll` fails to resolve.
 */
export async function runCompiler(
  config: Config,
  exe: string,
  args: readonly string[],
  timeoutMs: number,
  chain: Toolchain = "stock",
  game?: ResolvedGame,
): Promise<CompilerRun> {
  const dir = toolchainDir(config, chain, game);
  if (dir === null) {
    throw new ToolchainError(
      chain === "stock"
        ? `no Left 4 Dead 2 bin directory was found. The compilers ship with the game ` +
          `client, never with a dedicated server; point gameProfiles.l4d2.binDir at it, ` +
          `or run health to see what discovery found.`
        : `no directory is configured for the Tools++ compilers. Set ` +
          `gameProfiles.l4d2.plusPlusBinDir, or unpack Tools++ into externalToolsDir; the ` +
          `stock chain is unaffected and run_compile falls back to it. See health.`,
    );
  }
  const binary = join(dir, exe);
  if (!existsSync(binary)) {
    // Accept either naming convention for the same stage before calling it missing.
    const stage = /^(vbsp|vvis|vrad|bspzip)/.exec(exe)?.[1] as CompileStage | undefined;
    const alias =
      stage && chain !== "stock"
        ? compilerCandidates(stage, chain).find((n) => existsSync(join(dir, n)))
        : undefined;
    if (alias === undefined) {
      throw new ToolchainError(
        chain === "stock"
          ? `${binary} not found. Stock compilers ship with the Left 4 Dead 2 client, not ` +
            `with srcds; check gameProfiles.l4d2.binDir with the health tool`
          : // Naming the chain matters: without it this reads like a broken game install,
            // when in fact the stock compilers are fine and only Tools++ is absent.
            //
            // Reaching this at all means a caller drove runCompiler directly: run_compile
            // and run_pack ask chooseToolchain first, which falls back to stock and says so.
            `${binary} not found: the "plusplus" toolchain is not installed. The four ` +
            `compilers come from tools++_windows.zip and go in ${dir}; the stock chain is ` +
            `unaffected, and run_compile falls back to it. See health`,
      );
    }
    return launch(config, dir, alias, args, timeoutMs, chain);
  }
  return launch(config, dir, exe, args, timeoutMs, chain);
}

/** Runs one resolved compiler binary; split out so the alias path is the same code. */
async function launch(
  config: Config,
  dir: string,
  exe: string,
  args: readonly string[],
  timeoutMs: number,
  chain: Toolchain,
): Promise<CompilerRun> {
  const binary = join(dir, exe);
  const started = Date.now();
  const [cmd, cmdArgs, env] = windowsInvocation(binary, args);
  const result = await run(cmd, cmdArgs, { cwd: dir, timeoutMs, env });

  return {
    ...result,
    command: exe,
    args: [...args],
    durationMs: Date.now() - started,
  };
}

/**
 * The command line that executes a Windows binary.
 *
 * Windows only, by decision: this server drives the game's own `.exe` files directly.
 * The platform check is not decoration -- on another OS the call would fail deeper down
 * with a message about a missing file, which blames the game install.
 */
export function windowsInvocation(
  binary: string,
  args: readonly string[],
): [string, string[], NodeJS.ProcessEnv] {
  if (process.platform !== "win32") {
    throw new ToolchainError(
      `this server drives Windows binaries and runs on Windows only; this is ${process.platform}`,
    );
  }
  return [binary, [...args], process.env];
}
