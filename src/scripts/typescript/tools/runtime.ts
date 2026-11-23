import { execFileSync, spawn } from "node:child_process";
import { z } from "zod";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseNavDump } from "../../../nav/typescript/bsp/navdump.js";
import { checkNavFreshness } from "../../../nav/typescript/bsp/nav.js";
import {
  flowWarnings,
  gameExecutable,
  launchGame,
  navGenerateConfig,
  readLog,
  sleep,
  findGamePid,
  steamExecutable,
  guardRunningGame,
  stopGamePid,
  listGamePids,
  recordGamePid,
  clearRecordedGamePid,
  waitForFile,
  waitForNewGamePid,
  waitForLog,
  waitForMarkers,
  waitForMarkersAny,
} from "../game/launch.js";
import type { MarkerHit } from "../game/launch.js";
import {
  findShadowingVpks,
  hideFiles,
  resolveAddonPath,
  restoreFiles,
  stageMapPair,
} from "../../../packages/typescript/game/stage.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { captureWindow } from "../../../maps/typescript/screenshot/window.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { SCHEDULE_FILE, scheduleScript } from "../vscript/schedule.js";
import { STOCK_CFG, sweepInterruptedState } from "../game/state.js";

/** The lump name the engine appends to a BSP that has a string-table dictionary. */
const DICTIONARY_MARKER = Buffer.from("stringtable_dictionary");

/**
 * Whether a BSP carries the string-table dictionary the engine writes for `-stringtables`.
 *
 * A map without it loads, but the engine prints "missing stringtable dictionary, don't ship
 * this way" and -- the part that broke campaigns -- it appends the dictionary on the next
 * changelevel. That grows the BSP after nav has already recorded its size, so the nav is
 * stale by construction. Baking it *before* nav generation makes the pair stable.
 */
function hasStringtableDictionary(path: string): boolean {
  try {
    return readFileSync(path).includes(DICTIONARY_MARKER);
  } catch {
    return false;
  }
}

/** Ends any running client before a launch: Steam hands a second `+map` to the first one. */
async function stopGame(): Promise<void> {
  try {
    execFileSync("taskkill", ["/IM", "left4dead2.exe", "/F", "/T"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    // Not running. That is the normal case.
  }
  // `taskkill` returns before the process has actually left the process table. A launch
  // during that window is handed to the dying client and produces an empty console log,
  // which reads as a timeout with no evidence. Poll instead of guessing with one sleep.
  for (let i = 0; i < 20; i++) {
    try {
      const out = execFileSync(
        "tasklist",
        ["/FI", "IMAGENAME eq left4dead2.exe", "/NH"],
        { encoding: "utf8", windowsHide: true },
      );
      if (!/left4dead2\.exe/i.test(out)) break;
    } catch {
      break;
    }
    await sleep(300);
  }
  await sleep(500);
}

/**
 * Makes the engine append its string-table dictionary to a loose BSP.
 *
 * The engine only writes the dictionary on a map shutdown, so a plain `quit` does not do it;
 * a `changelevel` does. The config therefore changelevels to the same map. The second load
 * re-runs the config, which would loop forever, so this waits for the dictionary to appear
 * in the file and then ends the process.
 */
async function bakeStringtableDictionary(
  exe: string,
  cfgPath: string,
  consoleLog: string,
  loose: string,
  name: string,
  timeoutMs: number,
): Promise<boolean> {
  writeFileSync(cfgPath, `changelevel ${name}\n`, "utf8");
  rmSync(consoleLog, { force: true });
  const handle = launchGame(exe, [
    "-novid",
    "-console",
    "-allowdebug",
    "-insecure",
    "-condebug",
    "-stringtables",
    "+map",
    name,
  ]);
  const started = Date.now();
  // The marker appears before the dictionary is complete: the engine appends entries and
  // closes the file later. Killing on the marker produced a BSP with 45 of 89 strings, and
  // the client then failed signon with `net_SignonState` and stayed at the main menu.
  let stableSize = -1;
  let stableSince = 0;
  try {
    while (Date.now() - started < timeoutMs) {
      if (hasStringtableDictionary(loose)) {
        const size = statSync(loose).size;
        if (size !== stableSize) {
          stableSize = size;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= 2000) {
          return true;
        }
      }
      if (handle.child.exitCode !== null) return false;
      await sleep(750);
    }
  } finally {
    handle.stop();
    await sleep(1200);
  }
  return false;
}


export const runNavGenerate = defineTool({
  name: "run_nav_generate",
  description:
    "Generates nav meshes the only way Left 4 Dead 2 can: it launches the game client as a " +
    "listen server, with `sv_cheats 1` and `nav_edit 1`, and waits for the engine to write " +
    "each map's `.nav`. The map must be loose, so the tool copies it into " +
    "`left4dead2/maps`, moves every archive that contains the same map aside (and any named " +
    "in `addonsToHide`), and restores everything afterwards. Before generating, it bakes the " +
    "engine's string-table dictionary into the BSP with a `-stringtables` changelevel: the " +
    "dictionary is otherwise appended after nav is written, which makes the pair stale. " +
    "Returns the mesh, the exact BSP it describes, whether the dictionary is present, whether " +
    "`read_nav` would say `fresh`, and the engine's dump and flow warnings. Long-running and " +
    "guarded.",
  realm: "local",
  guarded: true,
  inputSchema: {
    maps: z
      .array(z.string())
      .min(1)
      .describe("Compiled .bsp files to generate nav for, absolute or relative to the repo."),
    addonsToHide: z
      .array(z.string())
      .default([])
      .describe(
        "Add-on archives to move aside while generating (for example a campaign VPK that " +
          "contains the same map names). A bare file name is resolved in the game's addons/ " +
          "directory. Restored even if generation fails.",
      ),
    autoHideShadowing: z
      .boolean()
      .optional()
      .describe(
        "Also move aside every installed VPK whose index contains maps/<map>.bsp (default " +
          "true). A mounted archive wins over the loose map, which is how a nav got generated " +
          "for last build's map. Pass false only when that archive's assets are needed and " +
          "you know the loose map wins.",
      ),
    outDir: z
      .string()
      .optional()
      .describe(
        "Directory for the generated .nav and <map>_nav.txt. Defaults to the directory of " +
          "each source .bsp.",
      ),
    timeoutSeconds: z.number().int().min(30).max(900).default(240).describe("Per map."),
    navSlopeLimit: z
      .number()
      .min(0.1)
      .max(1)
      .optional()
      .describe(
        "Passed to the engine as `nav_slope_limit` before generation. The ground normal's Z " +
          "must be greater than this; the default rejects steep ramps and escalators. 0.5 " +
          "allows a 60-degree slope. Absent leaves the game default.",
      ),
    replaceRunningGame: z
      .boolean()
      .optional()
      .describe(
        "Close a game that is already running before this test. Without it the call refuses: " +
          "a Steam launch takes over the single instance and drops the player to the main menu.",
      ),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    ok: z.boolean(),
    maps: z.array(
      z.object({
        map: z.string(),
        generated: z.boolean(),
        reason: z.enum(["matched", "exited", "timeout"]),
        nav: z.string().nullable(),
        bsp: z.string().nullable(),
        navBytes: z.number().nullable(),
        dump: z.string().nullable(),
        verdict: z.enum(["goal-present", "no-goal", "empty"]).nullable(),
        areas: z.number().nullable(),
        /** The BSP carries the engine's string-table dictionary. */
        stringtableDictionary: z.boolean(),
        /** The nav's saved BSP size equals the shipped BSP size. */
        fresh: z.boolean(),
        flowWarnings: z.array(z.string()),
        consoleTail: z.array(z.string()),
      }),
    ),
    restored: z.boolean(),
    /** Archives found by index and moved aside automatically, not named by the caller. */
    shadowingArchives: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const gameStateFile = join(ctx.config.stateDir, "running-game.json");
    guardRunningGame(args.replaceRunningGame ?? false, "run_nav_generate", gameStateFile);
    sweepInterruptedState(gameDir);
    const exe = gameExecutable(gameDir);
    if (!existsSync(exe)) throw new Error(`the game executable is not at ${exe}`);

    const mapsDir = join(gameDir, "maps");
    const cfgPath = join(gameDir, "cfg", "listenserver.cfg");
    const backup = `${cfgPath}.hsmcp-backup`;
    const consoleLog = join(gameDir, "console.log");
    mkdirSync(mapsDir, { recursive: true });

    if (!existsSync(cfgPath)) writeFileSync(cfgPath, STOCK_CFG, "utf8");
    if (!existsSync(backup)) copyFileSync(cfgPath, backup);
    writeFileSync(cfgPath, navGenerateConfig(args.navSlopeLimit), "utf8");

    const named = (args.addonsToHide ?? []).map((addon) =>
      resolveAddonPath(addon, (p) => resolveInput(p, ctx.config), gameDir),
    );
    const shadowingArchives: string[] = [];
    if (args.autoHideShadowing !== false) {
      for (const mapArg of args.maps) {
        const name = basename(resolveInput(mapArg, ctx.config), ".bsp");
        shadowingArchives.push(...(await findShadowingVpks(name, gameDir, ctx.config)));
      }
    }
    const hidden = hideFiles([...new Set([...named, ...shadowingArchives])]);

    const maps: Array<{
      map: string;
      generated: boolean;
      reason: "matched" | "exited" | "timeout";
      nav: string | null;
      bsp: string | null;
      navBytes: number | null;
      dump: string | null;
      verdict: "goal-present" | "no-goal" | "empty" | null;
      areas: number | null;
      stringtableDictionary: boolean;
      fresh: boolean;
      flowWarnings: string[];
      consoleTail: string[];
    }> = [];

    try {
      for (const mapArg of args.maps) {
        const source = resolveInput(mapArg, ctx.config);
        const name = basename(source, ".bsp");
        const loose = join(mapsDir, `${name}.bsp`);
        const engineNav = join(mapsDir, `${name}.nav`);
        const engineDump = join(mapsDir, `${name}_nav.txt`);
        const outDir = args.outDir
          ? resolveInput(args.outDir, ctx.config)
          : dirname(source);
        mkdirSync(outDir, { recursive: true });
        const outNav = join(outDir, `${name}.nav`);
        const outDump = join(outDir, `${name}_nav.txt`);
        const outBsp = join(outDir, `${name}.bsp`);

        await stopGame();
        copyFileSync(source, loose);
        rmSync(engineNav, { force: true });
        rmSync(engineDump, { force: true });
        rmSync(consoleLog, { force: true });

        // Bake before generating. The engine appends the dictionary at changelevel time and
        // does it *after* nav is written, which is why a nav generated on a dictionary-less
        // BSP is stale the moment the engine saves it. Baking first makes nav's savedBspSize
        // describe the file that ships.
        if (!hasStringtableDictionary(loose)) {
          await bakeStringtableDictionary(
            exe,
            cfgPath,
            consoleLog,
            loose,
            name,
            Math.min(args.timeoutSeconds * 1000, 90_000),
          );
        }

        let reason: "matched" | "exited" | "timeout" = "timeout";
        const generate = async (): Promise<void> => {
          writeFileSync(cfgPath, navGenerateConfig(args.navSlopeLimit), "utf8");
          rmSync(engineNav, { force: true });
          rmSync(engineDump, { force: true });
          rmSync(consoleLog, { force: true });
          const handle = launchGame(exe, [
            "-novid",
            "-console",
            "-allowdebug",
            "-insecure",
            "-condebug",
            "-stringtables",
            "+map",
            name,
          ]);
          try {
            reason = await waitForFile(
              engineNav,
              args.timeoutSeconds * 1000,
              () => handle.child.exitCode === null,
            );
          } finally {
            handle.stop();
            await sleep(1200);
          }
        };

        await generate();
        let generated = existsSync(engineNav);
        if (generated) {
          copyFileSync(engineNav, outNav);
          copyFileSync(loose, outBsp);
        }
        if (existsSync(engineDump)) copyFileSync(engineDump, outDump);

        // The pair is the contract. If the first pass still produced a stale pair (the
        // engine saved the dictionary after the mesh), the loose BSP now has the dictionary,
        // so one more pass produces a mesh whose saved size is the shipped size.
        if (generated && checkNavFreshness(outNav, outBsp).verdict !== "fresh") {
          await stopGame();
          copyFileSync(outBsp, loose);
          await generate();
          generated = existsSync(engineNav);
          if (generated) {
            copyFileSync(engineNav, outNav);
            copyFileSync(loose, outBsp);
          }
          if (existsSync(engineDump)) copyFileSync(engineDump, outDump);
        }

        const log = readLog(consoleLog);
        let verdict: "goal-present" | "no-goal" | "empty" | null = null;
        let areas: number | null = null;
        if (existsSync(outDump)) {
          try {
            const dump = parseNavDump(outDump, readFileSync(outDump, "utf8"));
            verdict = dump.verdict;
            areas = dump.areaCount;
          } catch {
            verdict = null;
          }
        }
        const freshness = generated ? checkNavFreshness(outNav, outBsp) : null;

        maps.push({
          map: name,
          generated,
          reason,
          nav: generated ? outNav : null,
          bsp: generated ? outBsp : null,
          navBytes: generated ? statSync(outNav).size : null,
          dump: existsSync(outDump) ? outDump : null,
          verdict,
          areas,
          stringtableDictionary: generated ? hasStringtableDictionary(outBsp) : false,
          fresh: freshness?.verdict === "fresh",
          flowWarnings: flowWarnings(log),
          consoleTail: log
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(-15),
        });

        rmSync(loose, { force: true });
        rmSync(engineNav, { force: true });
        rmSync(engineDump, { force: true });
        if (existsSync(mapsDir)) {
          for (const entry of readdirSync(mapsDir)) {
            if (entry.startsWith(`${name}.nav`) && entry !== `${name}.nav`) {
              rmSync(join(mapsDir, entry), { force: true });
            }
          }
        }
      }
    } finally {
      if (existsSync(backup)) {
        copyFileSync(backup, cfgPath);
        rmSync(backup, { force: true });
      }
      restoreFiles(hidden);
    }

    return { ok: maps.every((m) => m.generated && m.fresh), maps, restored: true, shadowingArchives };
  },
});

export const runMapTest = defineTool({
  name: "run_map_test",
  description:
    "Launches an installed map and watches the engine's console log for an ordered sequence of " +
    "patterns (or one), then " +
    "closes the game. This is the automated half of a play test: 'did the next chapter " +
    "load', 'did the finale script run', 'did the map finish loading at all'. The map must " +
    "already be installed in `left4dead2/maps` or a mounted add-on VPK. Returns the match, " +
    "the elapsed time and the log tail; the full log stays at `<game>/left4dead2/console.log`. " +
    "Set `markerOrder: 'any'` when several markers fire in one burst (for example the " +
    "`OnMapSpawn` probes from `write_entity_probe`); the default moves a cursor forward. " +
    "With `screenshot: true`, captures the game window as a real image block after the " +
    "marker; use `method: 'screen'` (the default) for a 3D game canvas. Match a marker that " +
    "fires after loading, such as `Loading: [0-9]`, before asking for a picture. " +
    "This starts the executable directly with `-insecure` for cheats and loose maps: it is a " +
    "test harness, not a normal-client check. A direct launch outside Steam reaches " +
    "`No Steam logon`; use `steam.exe -applaunch 550 ...` for the normal client.",
  realm: "local",
  guarded: true,
  inputSchema: {
    map: z.string().describe("Map name without a path or .bsp, for example hsmcp_test_m1."),
    mode: z
      .string()
      .optional()
      .describe(
        "Mode or mutation name: a modes/<name>.txt stem installed loose or in an add-on " +
          "VPK. L4D2 has no +mp_gamemode command and +map ignores a second argument, so " +
          "the first server start runs `map <map> <mode>` from listenserver.cfg. Omit for " +
          "the campaign's normal game mode.",
      ),
    bsp: z
      .string()
      .optional()
      .describe("Optional .bsp to install as this map name before launch; restored afterwards."),
    nav: z
      .string()
      .optional()
      .describe(
        "Optional .nav to install beside the map before launch. A loose BSP without its nav " +
          "loads with 'Map is unplayable!'; this copies the nav and restores any previous one.",
      ),
    waitFor: z
      .string()
      .optional()
      .describe(
        "Regular expression to find in the console log, e.g. a map name or a banner. " +
          "Required unless `markers` is given.",
      ),
    markers: z
      .array(
        z.object({
          name: z.string().describe("Step name for the timeline and `missing`."),
          pattern: z.string().describe("Regular expression, searched in new log lines only."),
          withinSeconds: z
            .number()
            .int()
            .min(1)
            .max(600)
            .optional()
            .describe(
              "Seconds from the previous marker (or from launch for the first). Defaults to " +
                "the whole run. A step that should follow in 20 s fails in 20 s.",
            ),
        }),
      )
      .default([])
      .describe(
        "An ordered sequence of assertions, searched one after another from the end of the " +
          "previous match. This is what turns 'did the map load' into 'did the finale start, " +
          "then the escape unlock, then the credits'. A `Loading:` line cannot satisfy a " +
          "later step because the cursor moves past each match.",
      ),
    markerOrder: z
      .enum(["ordered", "any"])
      .default("ordered")
      .describe(
        "`ordered` moves a cursor forward, for a sequence. `any` searches every marker in the " +
          "whole log independently, for events that fire together such as several " +
          "`OnMapSpawn` outputs; the timeline is still returned in marker order.",
      ),
    timeoutSeconds: z.number().int().min(10).max(600).default(120),
    via: z
      .enum(["direct", "steam"])
      .default("direct")
      .describe(
        "'direct' starts left4dead2.exe: fast, and a direct launch outside Steam reaches " +
          "'No Steam logon' after about a minute. 'steam' launches the same map through " +
          "`steam.exe -applaunch 550` without `-insecure`, waits for its process and " +
          "captures it. That is the normal-client path, but it only outlives the minute when " +
          "Steam authenticates the session: on this machine it still drops with `STEAMAUTH " +
          "failure code 8` / `No Steam logon`, so a long finale is blocked by the account, " +
          "not by the launcher.",
      ),
    extraArgs: z.array(z.string()).default([]).describe("Extra game command-line arguments."),
    addonsToHide: z
      .array(z.string())
      .default([])
      .describe(
        "Add-on archives to move aside for the run. A VPK that contains the same map name " +
          "wins over a loose copy in some mount orders, so a build test can otherwise load " +
          "last week's map. Restored afterwards.",
      ),
    scriptsDir: z
      .string()
      .optional()
      .describe(
        "A `scripts/vscripts` directory to install into the game for this run, with existing " +
          "files backed up and restored. Needed when the campaign VPK is hidden for a loose " +
          "map test but the map's `logic_script` or `_finale.nut` lives in that VPK.",
      ),
    commands: z
      .array(z.string())
      .default([])
      .describe(
        "Console commands written to `cfg/listenserver.cfg`, which the engine executes at server " +
          "start -- before the map's entities exist. `ent_fire` at that moment finds nothing; " +
          "for an action seconds later use `schedule`. The file is restored afterwards and " +
          "`sv_cheats 1` is prepended.",
      ),
    console: z
      .boolean()
      .default(true)
      .describe(
        "Open the in-game console window. Set false for a UI test: with it open every " +
          "keystroke goes into the console instead of the game. `-condebug` still writes " +
          "console.log, so markers keep working.",
      ),
    schedule: z
      .array(
        z.object({
          atSeconds: z.number().int().min(1).max(600),
          command: z.string().min(1),
        }),
      )
      .default([])
      .describe(
        "Server console commands at fixed seconds after the map loads, e.g. " +
          "`{ \"atSeconds\": 240, \"command\": \"echo HSMCP_TICK_240\" }`. A generated " +
          "`hsmcp_schedule.nut` spawns a `logic_timer` per entry and runs the command through " +
          "`point_servercommand`, so a marker can match at four minutes instead of seconds. " +
          "A command cannot contain a comma, a double quote or a newline: `AddOutput` passes " +
          "it comma-separated.",
      ),
    screenshot: z
      .boolean()
      .optional()
      .describe(
        "Capture the game window after the marker matches and return it as a real image " +
          "block. Use it for weather, skybox, lighting or a finale that only the eye can judge.",
      ),
    out: z
      .string()
      .optional()
      .describe("Screenshot path. Defaults to <stateDir>/screenshots/<map>-<time>.png."),
    waitAfterMatchMs: z
      .number()
      .int()
      .min(0)
      .max(15_000)
      .optional()
      .describe("How long to let the frame settle before capture. Default 1200 ms."),
    method: z
      .enum(["window", "screen"])
      .optional()
      .describe(
        "'screen' (default) brings the game forward and copies the desktop, which is what " +
          "captures a 3D game canvas; 'window' uses PrintWindow and is usually black for " +
          "the game renderer.",
      ),
    replaceRunningGame: z
      .boolean()
      .optional()
      .describe(
        "Close a game that is already running before this test. Without it the call refuses: " +
          "a Steam launch takes over the single instance and drops the player to the main menu.",
      ),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    map: z.string(),
    mode: z.string().nullable(),
    via: z.enum(["direct", "steam"]),
    matched: z.boolean(),
    reason: z.enum(["matched", "exited", "timeout"]),
    elapsedSeconds: z.number(),
    processId: z.number().nullable(),
    gameClosed: z.boolean(),
    captureError: z.string().nullable(),
    screenshotPath: z.string().nullable(),
    screenshotWidth: z.number().nullable(),
    screenshotHeight: z.number().nullable(),
    navInstalled: z.boolean(),
    bspInstalled: z.boolean(),
    scriptsInstalled: z.number(),
    commandsRun: z.array(z.string()),
    scheduleArmed: z.number(),
    addonsRestored: z.number(),
    stateRestored: z.number(),
    /** One entry per marker reached, in order, with the line that matched and its time. */
    timeline: z.array(
      z.object({
        name: z.string(),
        pattern: z.string(),
        matched: z.boolean(),
        atSeconds: z.number(),
        line: z.string().nullable(),
      }),
    ),
    /** Steps that were not reached; empty when the run matched. */
    missing: z.array(z.string()),
    logTail: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const gameStateFile = join(ctx.config.stateDir, "running-game.json");
    guardRunningGame(args.replaceRunningGame ?? false, "run_map_test", gameStateFile);
    const stateRestored = sweepInterruptedState(gameDir);
    const exe = gameExecutable(gameDir);
    if (!existsSync(exe)) throw new Error(`the game executable is not at ${exe}`);
    if (!args.waitFor && (args.markers?.length ?? 0) === 0) {
      throw new Error("pass waitFor or at least one marker; a test with no assertion is a launch");
    }
    // A previous client still running is a launch that goes to the old process: the new
    // command line is ignored and the wait sees no new log. The nav generator already did
    // this; the map test did not, and a compile immediately before a test could hit it.
    await stopGame();
    const consoleLog = join(gameDir, "console.log");
    // Truncate rather than delete: a delete that silently fails leaves yesterday's
    // "Mission credits" in the file and a wait-for match returns immediately.
    writeFileSync(consoleLog, "", "utf8");

    // A run killed mid-flight leaves a hidden addon as `*.vpk.off`; restoring it here keeps
    // the campaign menu honest and stops a later run from hiding nothing.
    const addonsDir = join(gameDir, "addons");
    let addonsRestored = 0;
    if (existsSync(addonsDir)) {
      for (const entry of readdirSync(addonsDir)) {
        if (!entry.toLowerCase().endsWith(".vpk.off")) continue;
        const target = join(addonsDir, entry.slice(0, -4));
        if (existsSync(target)) continue;
        renameSync(join(addonsDir, entry), target);
        addonsRestored += 1;
      }
    }

    const hidden = hideFiles(
      (args.addonsToHide ?? []).map((addon) =>
        resolveAddonPath(addon, (p) => resolveInput(p, ctx.config), gameDir),
      ),
    );
    const staged = stageMapPair({
      gameDir,
      map: args.map,
      ...(args.bsp ? { bsp: resolveInput(args.bsp, ctx.config) } : {}),
      ...(args.nav ? { nav: resolveInput(args.nav, ctx.config) } : {}),
    });

    // A hidden campaign VPK takes its scripts with it. A loose-map test of a VScript map
    // then reports `Entity <name> encountered an error in RunScript()` and the map looks
    // broken; installing the scripts beside the map is what makes the test test the map.
    const scriptBackups: Array<{ path: string; had: boolean }> = [];
    if (args.scriptsDir) {
      const source = resolveInput(args.scriptsDir, ctx.config);
      if (!existsSync(source)) throw new Error(`${source} does not exist`);
      const target = join(gameDir, "scripts", "vscripts");
      mkdirSync(target, { recursive: true });
      for (const entry of readdirSync(source)) {
        const from = join(source, entry);
        if (!statSync(from).isFile()) continue;
        const to = join(target, entry);
        const had = existsSync(to);
        if (had) {
          rmSync(`${to}.hsmcp-backup`, { force: true });
          copyFileSync(to, `${to}.hsmcp-backup`);
        }
        copyFileSync(from, to);
        scriptBackups.push({ path: to, had });
      }
    }

    // `listenserver.cfg` is how commands run after the map rather than before it. The
    // previous file is restored, because this is a test harness, not a server config.
    const cfgPath = join(gameDir, "cfg", "listenserver.cfg");
    const cfgBackup = `${cfgPath}.hsmcp-backup`;
    let commands = args.commands ?? [];
    if (args.mode) {
      // Measured: `+mp_gamemode` is an unknown command in this client, and a second
      // argument to `+map` is ignored (the log says "Script not found (coop)"). The map
      // command itself accepts the mode, and listenserver.cfg is where it can run.
      if (!/^[A-Za-z0-9_.-]+$/.test(args.mode)) {
        throw new Error(`mode "${args.mode}" is not a mode name`);
      }
      commands = [...commands, `map ${args.map} ${args.mode}`];
    }
    if (args.schedule.length > 0) {
      // Time moves only for map entities, so a test that looks four minutes in is driven by
      // a generated `logic_timer` script rather than by the harness.
      const target = join(gameDir, "scripts", "vscripts", SCHEDULE_FILE);
      mkdirSync(dirname(target), { recursive: true });
      const had = existsSync(target);
      if (had) {
        rmSync(`${target}.hsmcp-backup`, { force: true });
        copyFileSync(target, `${target}.hsmcp-backup`);
      }
      writeFileSync(target, scheduleScript(args.schedule), "utf8");
      scriptBackups.push({ path: target, had });
      commands = ["script_execute hsmcp_schedule", ...commands];
    }
    let cfgWritten = false;
    if (commands.length > 0) {
      mkdirSync(dirname(cfgPath), { recursive: true });
      if (existsSync(cfgPath)) {
        rmSync(cfgBackup, { force: true });
        copyFileSync(cfgPath, cfgBackup);
      }
      writeFileSync(cfgPath, ["sv_cheats 1", ...commands, ""].join("\n"), "utf8");
      cfgWritten = true;
    }

    const started = Date.now();
    const gameArgs = [
      "-novid",
      // A UI test needs the keyboard: with the VGUI console open every key goes into its text
      // field. `-condebug` writes console.log with or without the window.
      ...(args.console ? ["-console"] : []),
      "-allowdebug",
      // `-insecure` is for a direct launch's cheats and loose content. Through Steam it is
      // also what the client reports as `No Steam logon`, so the normal-client path keeps
      // its authentication; a listen server still accepts `sv_cheats 1`.
      ...(args.via === "direct" ? ["-insecure"] : []),
      "-condebug",
      "-stringtables",
      ...(args.extraArgs ?? []),
      "+map",
      args.map,
    ];
    let direct: ReturnType<typeof launchGame> | null = null;
    let gamePid: number | null = null;
    if (args.via === "steam") {
      const steam = steamExecutable();
      if (!steam) {
        throw new Error(
          "Steam was not found at the registry or the default install paths; pass " +
            "via:'direct' for a short test, or set STEAM_PATH",
        );
      }
      spawn(steam, ["-applaunch", "550", ...gameArgs], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      const before = listGamePids();
      const pid = await waitForNewGamePid(45_000, before);
      if (pid === null) {
        throw new Error(
          "Steam did not start left4dead2.exe within 45 s; check that Steam is running and " +
            "logged in, then retry",
        );
      }
      gamePid = pid;
      if (pid !== null) recordGamePid(gameStateFile, pid);
    } else {
      direct = launchGame(exe, gameArgs);
      gamePid = direct.child.pid ?? null;
      if (gamePid !== null) recordGamePid(gameStateFile, gamePid);
    }
    const runPid = gamePid;
    if (runPid === null) throw new Error("the game process has no pid");
    const alive = (): boolean => {
      try {
        process.kill(runPid, 0);
        return true;
      } catch {
        return false;
      }
    };
    let reason: "matched" | "exited" | "timeout" = "timeout";
    let screenshotPath: string | null = null;
    let screenshotWidth: number | null = null;
    let screenshotHeight: number | null = null;
    let image: { data: string; mimeType: string } | null = null;
    let timeline: MarkerHit[] = [];
    let missing: string[] = [];
    let gameClosed = false;
    let captureError: string | null = null;
    try {
      if ((args.markers?.length ?? 0) > 0) {
        const result =
          (args.markerOrder ?? "ordered") === "any"
            ? await waitForMarkersAny(
                consoleLog,
                args.markers,
                args.timeoutSeconds * 1000,
                alive,
              )
            : await waitForMarkers(
                consoleLog,
                args.markers,
                args.timeoutSeconds * 1000,
                alive,
              );
        reason = result.reason;
        timeline = result.hits;
        missing = result.missing;
      } else {
        reason = await waitForLog(
          consoleLog,
          new RegExp(args.waitFor!),
          args.timeoutSeconds * 1000,
          alive,
        );
      }
      if (args.screenshot && reason === "matched") {
        const pid = runPid;
        await sleep(args.waitAfterMatchMs ?? 1200);
        const out = args.out
          ? resolveInput(args.out, ctx.config)
          : join(
              ctx.config.stateDir,
              "screenshots",
              `${args.map}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
            );        mkdirSync(dirname(out), { recursive: true });
        try {
          const captured = await captureWindow(pid, out, 3000, args.method ?? "screen");
          screenshotPath = captured.path;
          screenshotWidth = captured.width;
          screenshotHeight = captured.height;
          image = {
            data: readFileSync(captured.path).toString("base64"),
            mimeType: "image/png",
          };
        } catch (error) {
          // The timeline already answered the test; a window that closed on the credits
          // map must not turn a matched run into a thrown error.
          captureError = error instanceof Error ? error.message : String(error);
        }
      }
    } finally {
      if (direct) direct.stop(); else stopGamePid(runPid);
      clearRecordedGamePid(gameStateFile);
      await sleep(1000);
      staged.restore();
      restoreFiles(hidden);
      if (cfgWritten) {
        rmSync(cfgPath, { force: true });
        if (existsSync(cfgBackup)) renameSync(cfgBackup, cfgPath);
      }
      for (const entry of scriptBackups) {
        rmSync(entry.path, { force: true });
        if (entry.had && existsSync(`${entry.path}.hsmcp-backup`)) {
          renameSync(`${entry.path}.hsmcp-backup`, entry.path);
        }
      }
      // The kill is asynchronous on Windows; re-read the process table and retry, so the
      // result can say the game is gone instead of assuming it.
      gameClosed = findGamePid() === null;
      for (let attempt = 0; attempt < 3 && !gameClosed; attempt += 1) {
        stopGamePid(runPid);
        await sleep(500);
        gameClosed = findGamePid() === null;
      }
    }

    const log = readLog(consoleLog);
    return {
      map: args.map,
      mode: args.mode ?? null,
      via: args.via,
      matched: reason === "matched",
      reason,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      processId: runPid,
      gameClosed,
      captureError,
      screenshotPath,
      screenshotWidth,
      screenshotHeight,
      navInstalled: staged.navInstalled,
      bspInstalled: staged.bspInstalled,
      scriptsInstalled: scriptBackups.length,
      commandsRun: commands,
      scheduleArmed: args.schedule.length,
      addonsRestored,
      stateRestored,
      timeline,
      missing,
      logTail: log
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-25),
      ...(image ? { _image: image } : {}),
    };
  },
});

export const runtimeTools = [runNavGenerate, runMapTest];
