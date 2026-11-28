import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { externalToolPresent } from "../../../maps/typescript/compile/external.js";
import { toolchainDir } from "../../../maps/typescript/compile/toolchain.js";
import { allGames, gameFor } from "../games/resolve.js";
import { defineTool } from "../mcp/registry.js";
import { probeSidecar } from "../sidecar/client.js";
import { externalTools } from "../../../maps/typescript/tools/rename.js";
import { buildFreshness, VERSION } from "../version.js";

/**
 * The build and source roots, from this module's location.
 *
 * Compiled, this module is `dist/core/typescript/tools/health.js`, so the build root is
 * three levels up and `src/` is its sibling. Under tsx the same arithmetic lands on `src`,
 * and comparing it with `src` reports "not stale" -- there is no separate build to age.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = join(HERE, "..", "..", "..");
const SRC_DIR = join(BUILD_DIR, "..", "src");

/** The Source tools this server drives, all of them Windows binaries. */
const BINARIES = ["vbsp.exe", "vvis.exe", "vrad.exe", "bspzip.exe", "vbspinfo.exe"];
/**
 * Extra .fgd files worth reporting on. The *required* ones are not listed here: they come
 * from the game's own `gameinfo.txt`, so this stays correct if Valve changes the file.
 */
const EXTRA_FGDS = ["base.fgd"];

/**
 * The Tools++ rebuild of the same compilers. Optional, and reported separately rather
 * than merged into the list above: it is a standalone download in its own directory, so
 * its absence is normal rather than a fault.
 */
const PLUSPLUS = [
  ["vbsp++.exe", "vbspplusplus.exe"],
  ["vvis++.exe", "vvisplusplus.exe"],
  ["vrad++.exe", "vradplusplus.exe"],
  ["bspzip++.exe", "bspzipplusplus.exe"],
] as const;

export const health = defineTool({
  name: "health",
  description:
    "State of the Left 4 Dead 2 toolchain this server depends on: repo root, the game's " +
    "bin directory (which ships with the client, not with srcds), which compilers and " +
    ".fgd files are present, whether the Python sidecar (srctools) is installed. Also " +
    "how many tools this server is serving and whether its build is older than the " +
    "source -- a stale build silently offers fewer tools. Start here when a tool reports " +
    "something missing, or is missing itself.",
  realm: "local",
  inputSchema: {},
  handler: async (_args, ctx) => {
    const { config } = ctx;
    const binDir = config.binDir;
    const binDirExists = binDir !== null && existsSync(binDir);

    const sidecar = await probeSidecar(config);

    // Never throws: health has to stay callable precisely when the configuration is what
    // is wrong. A bad default profile id is reported, not raised.
    let active: ReturnType<typeof gameFor> | null = null;
    let gamesError: string | null = null;
    try {
      active = gameFor(config);
    } catch (e) {
      gamesError = e instanceof Error ? e.message : String(e);
    }
    const profiles = gamesError ? {} : allGames(config);
    const fgdList = [...(active?.game.fgd ?? []), ...EXTRA_FGDS];

    const plusDir = toolchainDir(config, "plusplus", active?.game);
    const plusDirExists = plusDir !== null && existsSync(plusDir);
    const plusBinaries = Object.fromEntries(
      PLUSPLUS.map((names) => [
        names[0],
        plusDir !== null && names.some((n) => existsSync(join(plusDir, n))),
      ]),
    );

    // Hammer++ reads L4D2's comma I/O only. `Use special I/O delimiter (ESC)` (the ini's
    // IOParamNewDelimiter) is the setting behind "my outputs do nothing"; it is not visible
    // in a compile and not in a VMF until the entity fires. Report it before a map is built.
    const hpExe = binDir !== null ? join(binDir, "hammerplusplus.exe") : null;
    const hpSettings = binDir !== null ? join(binDir, "hammerplusplus", "hammerplusplus_settings.ini") : null;
    let ioDelimiter: string | null = null;
    let ioEsc: boolean | null = null;
    if (hpSettings !== null && existsSync(hpSettings)) {
      try {
        const text = readFileSync(hpSettings, "utf8");
        const m = /IOParamNewDelimiter\s*=\s*(\d+)/i.exec(text);
        ioDelimiter = m?.[1] ?? null;
        ioEsc = ioDelimiter === "1";
      } catch {
        ioEsc = null;
      }
    }

    return {
      version: VERSION,
      // How many tools this server is actually serving, and whether the build it is
      // serving them from is older than the source. A stale build is silent: it does not
      // throw, it just offers fewer tools, and every symptom reads as a missing feature.
      tools: {
        // Null rather than 0 when no registry was handed in: a caller reading zero would
        // conclude the server serves nothing, which is a different and wrong diagnosis.
        count: ctx.registry?.list().length ?? null,
        build: buildFreshness(BUILD_DIR, SRC_DIR),
      },
      repoRoot: config.repoRoot,
      stateDir: config.stateDir,
      auditLog: ctx.audit.path,
      game: gamesError
        ? { error: gamesError, active: null, known: [] }
        : {
            error: null,
            active: {
              id: active!.game.id,
              displayName: active!.game.displayName,
              branch: active!.game.branch,
              gameDir: active!.game.gameDir,
              binDir: active!.game.binDir,
              fgd: active!.game.fgd,
              instancePath: active!.game.instancePath,
              unusableForCompile: active!.game.unusableForCompile,
              // Which values were read off disk and which are built-in guesses. Only one
              // game has ever been run here, so this is not decoration.
              provenance: active!.game.provenance,
            },
            known: Object.entries(profiles).map(([id, g]) => ({
              id,
              displayName: g.displayName,
              installed: g.gameDir !== null,
              usableForCompile: g.unusableForCompile === null,
            })),
          },
      toolchain: {
        binDir: binDir,
        present: binDirExists,
        binaries: Object.fromEntries(
          BINARIES.map((b) => [b, binDir !== null && existsSync(join(binDir, b))]),
        ),
        fgd: Object.fromEntries(
          fgdList.map((f) => [f, binDir !== null && existsSync(join(binDir, f))]),
        ),
        gameDir: config.gameDir,
        gameDirPresent: config.gameDir !== null && existsSync(config.gameDir),
      },
      plusplus: {
        dir: plusDir,
        present: plusDirExists,
        binaries: plusBinaries,
        // Reported rather than inferred by the caller: "some of them" is the state that
        // produces a compile which starts and then fails at the second stage.
        usable: Object.values(plusBinaries).every(Boolean),
        note:
          "run_compile and run_pack DEFAULT to this chain, and fall back to the stock " +
          "compilers when it is absent -- saying so in toolchainNote rather than " +
          "substituting in silence. So absent is workable, not broken: it costs a much " +
          "slower vvis and the culling flags. From tools++_windows.zip (ficool2/misc_tools); " +
          "since October 2026 they are standalone and go wherever plusPlusBinDir points.",
      },
      hammerPlusPlus: {
        editor: hpExe,
        editorPresent: hpExe !== null && existsSync(hpExe),
        settings: hpSettings,
        settingsPresent: hpSettings !== null && existsSync(hpSettings),
        /** 0 is commas (L4D2), 1 is ESC (not L4D2). Null when the ini could not be read. */
        ioDelimiter,
        ioEsc,
        note:
          "Hammer++ must use comma I/O for L4D2: set `Use special I/O delimiter (ESC)` off " +
          "(IOParamNewDelimiter=0). The current Hammer++ builds are x64; a plain L4D2 " +
          "install is 32-bit, so use the last x86 build or the x86-64 beta. Instances are " +
          "fullbright in the lighting preview and cast no shadows -- preview only.",
      },
      // Standalone tools that belong to no game install, so nothing can discover them.
      // Absent is the normal state and the tools that need them say where to get them;
      // reported here so that is knowable before a call rather than at one.
      externalTools: {
        dir: config.externalToolsDir,
        present: existsSync(config.externalToolsDir!),
        tools: externalTools.map((t) => ({
          exe: t.exe,
          tool: t.tool,
          installed: externalToolPresent(config, t.exe),
        })),
        note:
          "From ficool2's tools page (https://ficool2.github.io/HammerPlusPlus-Website/" +
          "tools.html). Put the .exe in the directory above, or set externalToolsDir.",
      },
      platform: {
        kind: "windows",
        native: process.platform === "win32",
      },
      sidecar,
      guardedToolsAllowlisted: config.toolAllowlist,
      note:
        "This server never talks to a running game or a dedicated server. " +
        "Anything that needs the live engine belongs to a separate bridge.",
    };
  },
});

export const healthTools = [health];
