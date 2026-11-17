import { spawn, execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { gameExecutable, launchGame, sleep } from "../game/launch.js";
import { CONFIRM, resolveInput } from "./paths.js";

const STEAM_APP = "550";
const GAME_PROCESS = "left4dead2.exe";

function steamExecutable(): string | null {
  const roots = [
    process.env["ProgramFiles(x86)"],
    process.env["ProgramFiles"],
    "C:\\Program Files (x86)",
    "C:\\Program Files",
  ].filter((v): v is string => Boolean(v));
  for (const root of roots) {
    const exe = join(root, "Steam", "steam.exe");
    if (existsSync(exe)) return exe;
  }
  return null;
}

function gamePids(): number[] {
  try {
    const out = execFileSync(
      "tasklist",
      ["/FI", `IMAGENAME eq ${GAME_PROCESS}`, "/FO", "CSV", "/NH"],
      { encoding: "utf8", windowsHide: true },
    );
    return out
      .split(/\r?\n/)
      .map((line) => /^"left4dead2\.exe","(\d+)"/i.exec(line.trim())?.[1])
      .filter((v): v is string => Boolean(v))
      .map(Number);
  } catch {
    return [];
  }
}

function killPids(pids: readonly number[]): void {
  for (const pid of pids) {
    try {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // The process may already have exited; nothing else to do.
    }
  }
}

function listCubemaps(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".vtf"))
    .sort();
}

function launchWithSteam(steam: string, args: readonly string[]): void {
  spawn(steam, ["-applaunch", STEAM_APP, ...args], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  }).unref();
}

const MODE_LEVEL = { hdr: "2", ldr: "0" } as const;

/**
 * `-buildcubemaps` is the engine's own launch mode: load the map, capture every cubemap
 * sample, write the .vtf files, quit. It is the supported automation; injecting
 * `point_servercommand` ran `buildcubemaps` in the wrong context and produced the empty
 * "is not writable" path.
 */
export const runBuildCubemapsTool = defineTool({
  name: "run_build_cubemaps",
  description:
    "Builds a map's cubemaps with the engine's `-buildcubemaps` launch mode: the game loads " +
    "the map, captures every cubemap sample, writes .vtf files and quits. The map must be " +
    "loose, writable and have cubemap samples compiled in (an `env_cubemap` in the VMF); a " +
    "map packed in an add-on is copied out first. Copies the files to `outDir`, restores the " +
    "map, materials directory and hidden add-ons, and removes every test artefact in a " +
    "finally. LDR, HDR or both; the engine reloads for each mode. Long-running and guarded.",
  realm: "local",
  guarded: true,
  inputSchema: {
    map: z.string().describe("Map name without .bsp, e.g. hsmcp_test_m1."),
    bsp: z
      .string()
      .optional()
      .describe(
        "Compiled .bsp to install as this map name before building. If omitted, the map " +
          "must already be loose in left4dead2/maps.",
      ),
    mode: z
      .enum(["hdr", "ldr", "both"])
      .default("hdr")
      .describe("HDR is the L4D2 default. 'both' runs the engine twice, once per mode."),
    outDir: z
      .string()
      .optional()
      .describe(
        "Where to copy the .vtf files. Defaults to <stateDir>/cubemaps/<map>. Files are " +
          "copied out before the game install is restored.",
      ),
    addonsToHide: z
      .array(z.string())
      .default([])
      .describe(
        "Add-on archives to move aside while the loose map is loaded, so a packed copy " +
          "cannot shadow it. Restored even if the build fails.",
      ),
    timeoutSeconds: z.number().int().min(30).max(900).default(240).describe("Per mode."),
    confirm: CONFIRM,
  },
  outputSchema: {
    map: z.string(),
    outDir: z.string(),
    modes: z.array(
      z.object({
        mode: z.enum(["hdr", "ldr"]),
        built: z.boolean(),
        reason: z.enum(["built", "exited", "timeout"]),
        seconds: z.number(),
        files: z.array(z.object({ name: z.string(), path: z.string(), bytes: z.number() })),
      }),
    ),
    restored: z.boolean(),
    consoleTail: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const exe = gameExecutable(gameDir);
    if (!existsSync(exe)) throw new Error(`the game executable is not at ${exe}`);

    const mapsDir = join(gameDir, "maps");
    const target = join(mapsDir, `${args.map}.bsp`);
    const materials = join(gameDir, "materials", "maps", args.map);
    const materialsBackup = `${materials}.hsmcp-backup`;
    const mapBackup = `${target}.hsmcp-backup`;
    const consoleLog = join(gameDir, "console.log");
    const outDir = args.outDir
      ? resolveInput(args.outDir, ctx.config)
      : join(ctx.config.stateDir, "cubemaps", args.map);

    if (!args.bsp && !existsSync(target)) {
      throw new Error(
        `${target} does not exist and no bsp was given. Install the compiled map first or ` +
          `pass bsp: <path>.`,
      );
    }

    const hidden: Array<{ path: string; off: string }> = [];
    const hadMap = existsSync(target);
    const hadMaterials = existsSync(materials);
    const startedPids = new Set(gamePids());
    const modes: Array<{
      mode: "hdr" | "ldr";
      built: boolean;
      reason: "built" | "exited" | "timeout";
      seconds: number;
      files: Array<{ name: string; path: string; bytes: number }>;
    }> = [];
    let restored = false;

    try {
      mkdirSync(mapsDir, { recursive: true });
      if (args.bsp) {
        const source = resolveInput(args.bsp, ctx.config);
        if (existsSync(target)) copyFileSync(target, mapBackup);
        copyFileSync(source, target);
      }
      if (hadMaterials) renameSync(materials, materialsBackup);
      mkdirSync(materials, { recursive: true });

      for (const addon of args.addonsToHide ?? []) {
        const path = resolveInput(addon, ctx.config);
        if (!existsSync(path)) continue;
        const off = `${path}.off`;
        renameSync(path, off);
        hidden.push({ path, off });
      }

      const selectedMode = args.mode ?? "hdr";
      const timeoutSeconds = args.timeoutSeconds ?? 240;
      const wanted: Array<"hdr" | "ldr"> =
        selectedMode === "both" ? ["hdr", "ldr"] : [selectedMode];
      const steam = steamExecutable();

      for (const mode of wanted) {
        writeFileSync(consoleLog, "", "utf8");
        for (const old of listCubemaps(materials)) rmSync(join(materials, old), { force: true });

        const level = MODE_LEVEL[mode];
        const gameArgs = [
          "-novid",
          "-console",
          "-allowdebug",
          "-insecure",
          "-condebug",
          "-buildcubemaps",
          "+mat_hdr_level",
          level,
          "+map",
          args.map,
        ];
        const direct = steam ? null : launchGame(exe, gameArgs);
        if (steam) launchWithSteam(steam, gameArgs);

        const start = Date.now();
        let files: string[] = [];
        while (Date.now() - start < timeoutSeconds * 1000) {
          await sleep(2500);
          files = listCubemaps(materials);
          if (files.length > 0) {
            // The engine writes several files; give it a moment to finish the last one.
            await sleep(4000);
            files = listCubemaps(materials);
            break;
          }
        }
        const newPids = gamePids().filter((pid) => !startedPids.has(pid));
        killPids(newPids);

        const modeDir = selectedMode === "both" ? join(outDir, mode) : outDir;
        mkdirSync(modeDir, { recursive: true });
        const copied = files.map((name) => {
          const from = join(materials, name);
          const to = join(modeDir, name);
          copyFileSync(from, to);
          return { name, path: to, bytes: statSync(to).size };
        });
        const reason: "built" | "exited" | "timeout" =
          copied.length > 0 ? "built" : newPids.length === 0 ? "exited" : "timeout";
        modes.push({
          mode,
          built: copied.length > 0,
          reason,
          seconds: Math.round((Date.now() - start) / 1000),
          files: copied,
        });
        if (direct) direct.stop();
        await sleep(1000);
      }
    } finally {
      for (const entry of hidden) {
        if (existsSync(entry.off)) renameSync(entry.off, entry.path);
      }
      if (existsSync(materials)) rmSync(materials, { recursive: true, force: true });
      if (hadMaterials && existsSync(materialsBackup)) {
        renameSync(materialsBackup, materials);
      }
      if (existsSync(mapBackup)) {
        rmSync(target, { force: true });
        renameSync(mapBackup, target);
      } else if (!hadMap && existsSync(target)) {
        rmSync(target, { force: true });
      }
      restored = true;
    }

    const log = existsSync(consoleLog) ? readFileSync(consoleLog, "utf8") : "";
    return {
      map: args.map,
      outDir,
      modes,
      restored,
      consoleTail: log.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-20),
    };
  },
});

export const buildCubemapTools = [runBuildCubemapsTool];
