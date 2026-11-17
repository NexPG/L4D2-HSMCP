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
import { basename, dirname, join } from "node:path";import { parseNavDump } from "../bsp/navdump.js";
import {
  flowWarnings,
  gameExecutable,
  launchGame,
  navGenerateConfig,
  readLog,
  sleep,
  waitForFile,
  waitForLog,
} from "../game/launch.js";
import { defineTool } from "../mcp/registry.js";
import { captureWindow } from "../screenshot/window.js";
import { resolveInput } from "./paths.js";

const VEC3 = z.array(z.number()).length(3);

const runNavGenerate = defineTool({
  name: "run_nav_generate",
  description:
    "Generates nav meshes the only way Left 4 Dead 2 can: it launches the game client as a " +
    "listen server, with `sv_cheats 1` and `nav_edit 1`, and waits for the engine to write " +
    "each map's `.nav`. The map must be loose, so the tool copies it into " +
    "`left4dead2/maps`, moves the named add-on archives aside so they cannot shadow it, and " +
    "restores everything afterwards. Returns the mesh, the engine's `<map>_nav.txt` dump, " +
    "the decoded nav verdict and the flow warnings from the console. A map whose archive " +
    "contains the same map must be passed in `addonsToHide`. Long-running and guarded.",
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
          "contains the same map names). Restored even if generation fails.",
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
        verdict: z.enum(["playable", "no-goal", "no-flow", "empty"]).nullable(),
        areas: z.number().nullable(),
        flowWarnings: z.array(z.string()),
        consoleTail: z.array(z.string()),
      }),
    ),
    restored: z.boolean(),
  },
  handler: async (args, ctx) => {
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const exe = gameExecutable(gameDir);
    if (!existsSync(exe)) throw new Error(`the game executable is not at ${exe}`);

    const mapsDir = join(gameDir, "maps");
    const cfgPath = join(gameDir, "cfg", "listenserver.cfg");
    const backup = `${cfgPath}.hsmcp-backup`;
    const consoleLog = join(gameDir, "console.log");
    mkdirSync(mapsDir, { recursive: true });

    if (!existsSync(backup)) copyFileSync(cfgPath, backup);
    writeFileSync(cfgPath, navGenerateConfig(args.navSlopeLimit), "utf8");

    const hidden: Array<{ path: string; off: string }> = [];
    for (const addon of args.addonsToHide ?? []) {
      const path = resolveInput(addon, ctx.config);
      if (!existsSync(path)) continue;
      const off = `${path}.off`;
      renameSync(path, off);
      hidden.push({ path, off });
    }

    const maps: Array<{
      map: string;
      generated: boolean;
      reason: "matched" | "exited" | "timeout";
      nav: string | null;
      bsp: string | null;
      navBytes: number | null;
      dump: string | null;
      verdict: "playable" | "no-goal" | "no-flow" | "empty" | null;
      areas: number | null;
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

        copyFileSync(source, loose);
        rmSync(engineNav, { force: true });
        rmSync(engineDump, { force: true });
        rmSync(consoleLog, { force: true });

        const handle = launchGame(exe, [
          "-novid",
          "-console",
          "-allowdebug",
          "-insecure",
          "-condebug",
          "+map",
          name,
        ]);
        let reason: "matched" | "exited" | "timeout" = "timeout";
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

        const generated = existsSync(engineNav);
        const outDir = args.outDir
          ? resolveInput(args.outDir, ctx.config)
          : dirname(source);
        mkdirSync(outDir, { recursive: true });
        const outNav = join(outDir, `${name}.nav`);
        const outDump = join(outDir, `${name}_nav.txt`);
        const outBsp = join(outDir, `${name}.bsp`);
        if (generated) {
          copyFileSync(engineNav, outNav);
          // The engine rewrites the BSP's stringtable dictionary before it writes the nav
          // mesh. The nav's savedBspSize is the size of *that* file, so the exact BSP the
          // engine used is staged beside the nav. Do not hand the caller a nav and a
          // pre-generation BSP: the pair reads as stale and the game says "unplayable".
          copyFileSync(loose, outBsp);
        }
        if (existsSync(engineDump)) copyFileSync(engineDump, outDump);

        const log = readLog(consoleLog);
        let verdict: "playable" | "no-goal" | "no-flow" | "empty" | null = null;
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
      for (const entry of hidden) {
        if (existsSync(entry.off)) renameSync(entry.off, entry.path);
      }
    }

    return { ok: maps.every((m) => m.generated), maps, restored: true };
  },
});

const runMapTest = defineTool({
  name: "run_map_test",
  description:
    "Launches an installed map and watches the engine's console log for a pattern, then " +
    "closes the game. This is the automated half of a play test: 'did the next chapter " +
    "load', 'did the finale script run', 'did the map finish loading at all'. The map must " +
    "already be installed in `left4dead2/maps` or a mounted add-on VPK. Returns the match, " +
    "the elapsed time and the log tail; the full log stays at `<game>/left4dead2/console.log`. " +
    "With `screenshot: true`, captures the game window as a real image block after the " +
    "marker; use `method: 'screen'` (the default) for a 3D game canvas. Match a marker that " +
    "fires after loading, such as `Loading: [0-9]`, before asking for a picture.",
  realm: "local",
  guarded: true,
  inputSchema: {
    map: z.string().describe("Map name without a path or .bsp, for example hsmcp_test_m1."),
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
      .describe("Regular expression to find in the console log, e.g. a map name or a banner."),
    timeoutSeconds: z.number().int().min(10).max(600).default(120),
    extraArgs: z.array(z.string()).default([]).describe("Extra game command-line arguments."),
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
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    map: z.string(),
    matched: z.boolean(),
    reason: z.enum(["matched", "exited", "timeout"]),
    elapsedSeconds: z.number(),
    processId: z.number().nullable(),
    screenshotPath: z.string().nullable(),
    screenshotWidth: z.number().nullable(),
    screenshotHeight: z.number().nullable(),
    navInstalled: z.boolean(),
    bspInstalled: z.boolean(),
    logTail: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const exe = gameExecutable(gameDir);
    if (!existsSync(exe)) throw new Error(`the game executable is not at ${exe}`);
    const consoleLog = join(gameDir, "console.log");
    // Truncate rather than delete: a delete that silently fails leaves yesterday's
    // "Mission credits" in the file and a wait-for match returns immediately.
    writeFileSync(consoleLog, "", "utf8");

    const targetNav = join(gameDir, "maps", `${args.map}.nav`);
    const navBackup = `${targetNav}.hsmcp-backup`;
    const targetBsp = join(gameDir, "maps", `${args.map}.bsp`);
    const bspBackup = `${targetBsp}.hsmcp-backup`;
    let navInstalled = false;
    let bspInstalled = false;
    let hadNav = false;
    let hadBsp = false;
    if (args.bsp) {
      const sourceBsp = resolveInput(args.bsp, ctx.config);
      if (!existsSync(sourceBsp)) throw new Error(`${sourceBsp} does not exist`);
      mkdirSync(dirname(targetBsp), { recursive: true });
      if (existsSync(targetBsp)) {
        copyFileSync(targetBsp, bspBackup);
        hadBsp = true;
      }
      copyFileSync(sourceBsp, targetBsp);
      bspInstalled = true;
    }
    if (args.nav) {
      const sourceNav = resolveInput(args.nav, ctx.config);
      if (!existsSync(sourceNav)) throw new Error(`${sourceNav} does not exist`);
      mkdirSync(dirname(targetNav), { recursive: true });
      if (existsSync(targetNav)) {
        copyFileSync(targetNav, navBackup);
        hadNav = true;
      }
      copyFileSync(sourceNav, targetNav);
      navInstalled = true;
    }

    const started = Date.now();
    const handle = launchGame(exe, [
      "-novid",
      "-console",
      "-allowdebug",
      "-insecure",
      "-condebug",
      ...(args.extraArgs ?? []),
      "+map",
      args.map,
    ]);
    let reason: "matched" | "exited" | "timeout" = "timeout";
    let screenshotPath: string | null = null;
    let screenshotWidth: number | null = null;
    let screenshotHeight: number | null = null;
    let image: { data: string; mimeType: string } | null = null;
    try {
      reason = await waitForLog(
        consoleLog,
        new RegExp(args.waitFor),
        args.timeoutSeconds * 1000,
        () => handle.child.exitCode === null,
      );
      if (args.screenshot && reason === "matched") {
        const pid = handle.child.pid;
        if (pid === undefined) throw new Error("the game process has no pid to capture");
        await sleep(args.waitAfterMatchMs ?? 1200);
        const out = args.out
          ? resolveInput(args.out, ctx.config)
          : join(
              ctx.config.stateDir,
              "screenshots",
              `${args.map}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
            );
        mkdirSync(dirname(out), { recursive: true });
        const captured = await captureWindow(pid, out, 3000, args.method ?? "screen");
        screenshotPath = captured.path;
        screenshotWidth = captured.width;
        screenshotHeight = captured.height;
        image = {
          data: readFileSync(captured.path).toString("base64"),
          mimeType: "image/png",
        };
      }
    } finally {
      handle.stop();
      await sleep(1000);
      if (navInstalled) {
        rmSync(targetNav, { force: true });
        if (hadNav && existsSync(navBackup)) renameSync(navBackup, targetNav);
      }
      if (bspInstalled) {
        rmSync(targetBsp, { force: true });
        if (hadBsp && existsSync(bspBackup)) renameSync(bspBackup, targetBsp);
      }
    }

    const log = readLog(consoleLog);
    return {
      map: args.map,
      matched: reason === "matched",
      reason,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      processId: handle.child.pid ?? null,
      screenshotPath,
      screenshotWidth,
      screenshotHeight,
      navInstalled,
      bspInstalled,
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
