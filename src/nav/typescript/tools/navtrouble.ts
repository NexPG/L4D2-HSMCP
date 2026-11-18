import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { parseNavDump } from "../bsp/navdump.js";
import {
  offlineNavTrouble,
  parseNavTrouble,
  parseSavedSelection,
  parseSelectedPositions,
} from "../bsp/navtrouble.js";
import { gameExecutable, launchGame, readLog, sleep, waitForLog } from "../../../scripts/typescript/game/launch.js";
import {
  findShadowingVpks,
  hideFiles,
  resolveAddonPath,
  restoreFiles,
  stageMapPair,
} from "../../../packages/typescript/game/stage.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";

const FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
  count: z.number().optional(),
  centers: z.array(z.array(z.number()).length(3)).optional(),
});

const CHECK = z.object({
  name: z.string(),
  passed: z.boolean(),
  areas: z.number().nullable(),
  raw: z.string(),
});

export const navTroubleReport = defineTool({
  name: "nav_trouble_report",
  description:
    "Runs Left 4 Dead 2's own `nav_trouble_report` in the engine and returns its checks as " +
    "structured findings, or analyses a `<map>_nav.txt` dump offline. The engine's report " +
    "is the authority: it selects the offending areas (orphans, missing Finale/Checkpoint/" +
    "Battlefield attributes, overlaps, corner-to-corner connections, climbs) and this tool " +
    "then asks the engine to dump the selected areas' centres, so a failure comes back with " +
    "coordinates instead of a count. That is the difference between '3 areas are missing " +
    "FINALE' and the three places to fix. Offline mode only claims what the dump supports: " +
    "goal areas, orphans and the escape route. Give exactly one of `map` or `dump`. " +
    "Live mode is long-running and guarded.",
  realm: "local",
  guarded: true,
  inputSchema: {
    map: z
      .string()
      .optional()
      .describe("Map name without a path or .bsp, for the live engine report."),
    bsp: z
      .string()
      .optional()
      .describe("Optional .bsp to install as this map before the live run; restored afterwards."),
    nav: z
      .string()
      .optional()
      .describe("Optional .nav to install beside the map; restored afterwards."),
    dump: z
      .string()
      .optional()
      .describe("Path to `<map>_nav.txt`, for the offline summary instead of a live run."),
    expected: z
      .enum(["checkpoint", "finale", "either", "none"])
      .default("either")
      .describe(
        "Offline only: the goal this chapter must have. middle/first -> checkpoint, " +
          "last -> finale, single -> either.",
      ),
    check: z
      .string()
      .optional()
      .describe(
        "Live only: run one engine check by name (`orphan`, `checkpoint`, `finale`, " +
          "`battlefield`, `overlap`, `corner`) instead of the full report.",
      ),
    addonsToHide: z
      .array(z.string())
      .default([])
      .describe(
        "Archives to move aside for the live run. A bare file name is resolved in the " +
          "game's addons/ directory.",
      ),
    autoHideShadowing: z
      .boolean()
      .optional()
      .describe(
        "Also move aside every installed VPK whose index contains maps/<map>.bsp (default " +
          "true). A mounted archive wins over the loose map.",
      ),
    timeoutSeconds: z.number().int().min(20).max(300).default(90),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    mode: z.enum(["live", "offline"]),
    map: z.string().nullable(),
    dump: z.string().nullable(),
    checks: z.array(CHECK),
    failures: z.array(CHECK),
    selectedAreas: z.number().nullable(),
    selectedPoints: z.array(z.array(z.number()).length(3)),
    selected: z.array(
      z.object({
        id: z.number(),
        center: z.array(z.number()).length(3),
        attributes: z.number(),
        spawnAttributes: z.number(),
        connections: z.array(z.number()),
      }),
    ),
    findings: z.array(FINDING),
    verdict: z.enum(["pass", "fail", "warn", "unknown"]),
    consoleTail: z.array(z.string()),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const live = args.map !== undefined;
    const offline = args.dump !== undefined;
    if (live === offline) {
      throw new Error("give exactly one of `map` (live engine report) or `dump` (offline)");
    }

    if (!live) {
      const path = resolveInput(args.dump as string, ctx.config);
      const report = parseNavDump(path, readFileSync(path, "utf8"));
      const analysis = offlineNavTrouble(report, args.expected);
      return {
        mode: "offline" as const,
        map: null,
        dump: path,
        checks: [],
        failures: [],
        selectedAreas: null,
        selectedPoints: [],
        selected: [],
        findings: analysis.findings,
        verdict: analysis.verdict,
        consoleTail: [],
        note:
          `Read ${report.areaCount} area(s): ${report.summary.checkpoint} checkpoint, ` +
          `${report.summary.finale} finale, ${report.summary.escapeRoute} on the escape route. ` +
          `The dump has connection counts, not endpoints, so overlap and corner-to-corner ` +
          `are not judged here; run the live report for those.`,
      };
    }

    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const exe = gameExecutable(gameDir);
    if (!existsSync(exe)) throw new Error(`the game executable is not at ${exe}`);
    const map = args.map as string;
    const consoleLog = join(gameDir, "console.log");
    const cfgPath = join(gameDir, "cfg", "listenserver.cfg");
    const cfgBackup = `${cfgPath}.hsmcp-backup`;
    const mapsDir = join(gameDir, "maps");
    mkdirSync(mapsDir, { recursive: true });
    const xyzPath = join(mapsDir, `${map}_xyz.txt`);
    const txtBefore = new Map(
      readdirSync(mapsDir)
        .filter((f) => f.toLowerCase().endsWith(".txt"))
        .map((f) => [f, statSync(join(mapsDir, f)).size] as const),
    );

    const named = (args.addonsToHide ?? []).map((addon) =>
      resolveAddonPath(addon, (p) => resolveInput(p, ctx.config), gameDir),
    );
    const shadowing =
      args.autoHideShadowing === false ? [] : await findShadowingVpks(map, gameDir, ctx.config);
    const hidden = hideFiles([...new Set([...named, ...shadowing])]);

    mkdirSync(mapsDir, { recursive: true });
    mkdirSync(dirname(cfgPath), { recursive: true });
    if (existsSync(cfgPath)) copyFileSync(cfgPath, cfgBackup);
    const check = args.check ? ` ${args.check}` : "";
    writeFileSync(
      cfgPath,
      [
        "sv_cheats 1",
        "nav_edit 1",
        `nav_trouble_report${check}`,
        // The command selects what it found. L4D2 has no `nav_dump_selected_set_positions`
        // (that is Source SDK 2013); it has `nav_save_selected`, which writes the selected
        // set to `maps/<map>.txt` for `nav_merge_mesh`. That file is how a count becomes
        // coordinates in this game.
        "nav_save_selected",
        "echo HSMCP_NAV_TROUBLE_DONE",
        "",
      ].join("\n"),
      "utf8",
    );

    const staged = stageMapPair({
      gameDir,
      map,
      ...(args.bsp ? { bsp: resolveInput(args.bsp, ctx.config) } : {}),
      ...(args.nav ? { nav: resolveInput(args.nav, ctx.config) } : {}),
    });

    writeFileSync(consoleLog, "", "utf8");
    rmSync(xyzPath, { force: true });
    const handle = launchGame(exe, [
      "-novid",
      "-console",
      "-allowdebug",
      "-insecure",
      "-condebug",
      "-stringtables",
      "+map",
      map,
    ]);
    let reason: "matched" | "exited" | "timeout" = "timeout";
    try {
      reason = await waitForLog(
        consoleLog,
        /HSMCP_NAV_TROUBLE_DONE/,
        args.timeoutSeconds * 1000,
        () => handle.child.exitCode === null,
      );
    } finally {
      handle.stop();
      await sleep(1200);
      staged.restore();
      restoreFiles(hidden);
      if (existsSync(cfgBackup)) {
        copyFileSync(cfgBackup, cfgPath);
        rmSync(cfgBackup, { force: true });
      }
    }

    const log = readLog(consoleLog);
    const report = parseNavTrouble(log);

    // `nav_save_selected` names its output itself. Rather than guess, take every .txt that
    // appeared or grew during the run; the selected-set parser ignores files that are not
    // one, so a stray unrelated write cannot become coordinates.
    const changed = readdirSync(mapsDir).filter((f) => {
      if (!f.toLowerCase().endsWith(".txt")) return false;
      const before = txtBefore.get(f);
      const size = statSync(join(mapsDir, f)).size;
      return before === undefined || size !== before;
    });
    let selected: ReturnType<typeof parseSavedSelection> = [];
    for (const file of changed) {
      const path = join(mapsDir, file);
      const text = readFileSync(path, "utf8");
      const areas = parseSavedSelection(text);
      if (areas.length > 0 && selected.length === 0) {
        selected = areas;
        report.selectedPoints = areas.map((a) => a.center);
      }
      if (report.selectedPoints.length === 0) {
        const points = parseSelectedPositions(text);
        if (points.length > 0) report.selectedPoints = points;
      }
      // Only delete what this run created: a pre-existing .txt that grew may be the
      // caller's file, and deleting it would be a write nobody asked for.
      if (txtBefore.get(file) === undefined) rmSync(path, { force: true });
    }
    if (existsSync(xyzPath)) {
      report.selectedPoints = parseSelectedPositions(readFileSync(xyzPath, "utf8"));
      rmSync(xyzPath, { force: true });
    }
    const findings = report.failures.map((failure) => ({
      severity: "error" as const,
      rule: `nav-engine-${failure.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      message:
        `${failure.name} check found ${failure.areas ?? "?"} area(s)` +
        (report.selectedPoints.length > 0
          ? `; the selected centres are in selectedPoints`
          : `; the engine did not write a selection file`),
      ...(failure.areas !== null ? { count: failure.areas } : {}),
    }));

    const note =
      reason === "matched"
        ? `The engine finished its trouble report in ${args.timeoutSeconds}s or less.`
        : `The engine did not print the completion marker (${reason}); the checks below are ` +
          `whatever the log contained, and a missing check is not a pass.`;

    return {
      mode: "live" as const,
      map,
      dump: null,
      checks: report.checks,
      failures: report.failures,
      selectedAreas: report.selectedAreas,
      selectedPoints: report.selectedPoints,
      selected: selected.map(({ id, center, attributes, spawnAttributes, connections }) => ({
        id,
        center,
        attributes,
        spawnAttributes,
        connections,
      })),
      findings,
      verdict: report.verdict,
      consoleTail: log
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-30),
      note,
    };
  },
});

export const navTroubleTools = [navTroubleReport];
