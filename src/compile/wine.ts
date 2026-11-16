import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { run } from "@projectsociety/mcp-core";
import type { RunResult } from "@projectsociety/mcp-core";
import type { Config } from "../config.js";
import type { ResolvedGame } from "../games/profile.js";

export class ToolchainError extends Error {}

/**
 * Converts a Linux path to the Windows form the compilers need.
 *
 * Wine maps `Z:` to `/`, so `/home/x` becomes `Z:\home\x`. This is not cosmetic: a
 * relative path is resolved against wine's own working directory, and vbsp then compiles
 * a different file than the one asked for, silently and successfully.
 *
 * A path that is already a Windows drive path (the `native` backend, on Windows) only has
 * its separators normalised: prefixing it with `Z:` would produce `Z:C:\...`.
 */
export function toWindowsPath(path: string): string {
  if (/^[A-Za-z]:[\\/]/.test(path)) return path.replace(/\//g, "\\");
  if (!isAbsolute(path)) {
    throw new ToolchainError(
      `${path}: the Source compilers need an absolute path, because a relative one ` +
        `resolves against wine's working directory and quietly compiles the wrong file`,
    );
  }
  return `Z:${path.replace(/\//g, "\\")}`;
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

/** `vbsp.exe` or `vbspplusplus.exe`. One place knows the naming convention. */
export function compilerExe(stage: CompileStage, chain: Toolchain): string {
  return chain === "stock" ? `${stage}.exe` : `${stage}plusplus.exe`;
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
          .map((s) => compilerExe(s, requested))
          .filter((exe) => !existsSync(join(dir, exe)));

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
          `tools_plusplus.zip (ficool2/misc_tools); health reports which are present.`,
  };
}

/**
 * Runs one Source compiler under wine.
 *
 * Two settings are load-bearing, both measured rather than guessed (README, gate A):
 * the working directory must be the `bin` folder or `tier0.dll` fails to resolve, and
 * `WINEDEBUG=-all` must be set or stderr is a wall of `fixme:` lines that buries the
 * compiler's own output.
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
          `compilers come from tools_plusplus.zip and go in ${dir}; the stock chain is ` +
          `unaffected, and run_compile falls back to it. See health`,
    );
  }
  const started = Date.now();
  const [cmd, cmdArgs, env] = windowsInvocation(config, binary, args);
  const result = await run(cmd, cmdArgs, { cwd: dir, timeoutMs, env });

  return {
    ...result,
    command: exe,
    args: [...args],
    durationMs: Date.now() - started,
  };
}

/**
 * The command line that executes a Windows binary under the configured backend.
 *
 * `native` runs the .exe directly and only means something on Windows. `wine` keeps the
 * two settings measured as load-bearing: `WINEPREFIX`, and `WINEDEBUG=-all` so wine's
 * `fixme:` lines do not bury the tool's own output.
 */
export function windowsInvocation(
  config: Config,
  binary: string,
  args: readonly string[],
): [string, string[], NodeJS.ProcessEnv] {
  if (config.backend === "native") {
    if (process.platform !== "win32") {
      throw new ToolchainError(
        `backend "native" runs the Windows binaries directly and needs Windows; ` +
          `this is ${process.platform}`,
      );
    }
    return [binary, [...args], process.env];
  }
  if (config.backend !== "wine") {
    throw new ToolchainError(
      `backend "${config.backend}" is not implemented; only wine and native are proven here`,
    );
  }
  return [
    "wine",
    [binary, ...args],
    { ...process.env, WINEPREFIX: config.winePrefix, WINEDEBUG: "-all" },
  ];
}
