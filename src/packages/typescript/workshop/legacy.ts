/**
 * The legacy Steam content path.
 *
 * L4D2 predates ISteamUGC content transfer. `SetItemContent`, `updateItemContent` and
 * SteamCMD's `workshop_build_item` all answer `k_EResultInvalidParam` for a VPK, while
 * `ISteamRemoteStorage::PublishWorkshopFile` and its update request work — that is the
 * path the game's own Authoring Tools still use. No published npm binding exposes those
 * calls, so this module compiles a small C# helper with the .NET Framework compiler that
 * ships with Windows. The helper source is `legacy/WorkshopLegacy.cs`; it uses the
 * `steam_api64.dll` bundled with `@hagicode/steamworks.js` and the running Steam client,
 * so it never asks for or stores a password.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../../../core/typescript/config.js";
import { run } from "../../../core/typescript/proc/run.js";
import { L4D2_CREATOR_APP_ID, steamApiDllPath } from "./client.js";

type LegacyField = string | number | boolean | readonly string[] | undefined;

export interface LegacyHelper {
  exe: string;
  cacheDir: string;
  source: string;
  dll: string;
  csc: string;
}

let building: Promise<LegacyHelper> | null = null;

function helperSourcePath(config: Config): string {
  const beside = join(dirname(fileURLToPath(import.meta.url)), "legacy", "WorkshopLegacy.cs");
  if (existsSync(beside)) return beside;
  const fromSource = join(
    config.repoRoot,
    "src",
    "packages",
    "typescript",
    "workshop",
    "legacy",
    "WorkshopLegacy.cs",
  );
  if (existsSync(fromSource)) return fromSource;
  throw new Error(
    `The Workshop upload helper source is missing (looked at ${beside} and ${fromSource}). ` +
      "A package build copies it with `pnpm build`; in a source checkout the file is " +
      "src/packages/typescript/workshop/legacy/WorkshopLegacy.cs.",
  );
}

function cscPath(): string | null {
  const windows = process.env.WINDIR ?? "C:\\Windows";
  const candidates = [
    join(windows, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(windows, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function isStale(helper: LegacyHelper): boolean {
  if (!existsSync(helper.exe)) return true;
  if (!existsSync(join(helper.cacheDir, "steam_api64.dll"))) return true;
  if (!existsSync(join(helper.cacheDir, "steam_appid.txt"))) return true;
  try {
    const exeTime = statSync(helper.exe).mtimeMs;
    return (
      exeTime < statSync(helper.source).mtimeMs || exeTime < statSync(helper.dll).mtimeMs
    );
  } catch {
    return true;
  }
}

async function buildHelper(config: Config): Promise<LegacyHelper> {
  const source = helperSourcePath(config);
  const dll = steamApiDllPath();
  if (dll === null) {
    throw new Error(
      "The Steam API DLL was not found. Install the toolkit dependencies with " +
        "`pnpm install`; it ships inside @hagicode/steamworks.js.",
    );
  }
  const csc = cscPath();
  if (csc === null) {
    throw new Error(
      "The Workshop upload helper is compiled with the .NET Framework compiler that ships " +
        "with Windows, but csc.exe was not found under %WINDIR%\\Microsoft.NET. This is " +
        "unusual on Windows 10/11; install .NET Framework 4.x and retry.",
    );
  }

  const cacheDir = join(config.stateDir, "workshop", "legacy");
  const helper: LegacyHelper = {
    exe: join(cacheDir, "WorkshopLegacy.exe"),
    cacheDir,
    source,
    dll,
    csc,
  };
  if (!isStale(helper)) return helper;

  mkdirSync(cacheDir, { recursive: true });
  copyFileSync(dll, join(cacheDir, "steam_api64.dll"));
  writeFileSync(join(cacheDir, "steam_appid.txt"), String(L4D2_CREATOR_APP_ID), "ascii");

  const build = await run(
    csc,
    [
      "/nologo",
      "/target:exe",
      "/platform:anycpu",
      "/optimize+",
      `/out:${helper.exe}`,
      source,
    ],
    { cwd: cacheDir, timeoutMs: 120_000 },
  );
  if (build.code !== 0 || !existsSync(helper.exe)) {
    throw new Error(
      "The Workshop upload helper did not compile. " +
        `csc.exe exited ${String(build.code)}.\n${build.stdout}\n${build.stderr}`,
    );
  }
  return helper;
}

/** Builds the helper once per process (and once per source change) and reuses it. */
export async function ensureLegacyHelper(config: Config): Promise<LegacyHelper> {
  if (building === null) {
    building = buildHelper(config).finally(() => {
      building = null;
    });
  }
  return building;
}

/** Reports helper paths without compiling anything. */
export function legacyHelperStatus(config: Config): {
  source: string | null;
  csc: string | null;
  dll: string | null;
  cacheDir: string;
  exe: string;
  built: boolean;
  stale: boolean;
} {
  let source: string | null = null;
  try {
    source = helperSourcePath(config);
  } catch {
    source = null;
  }
  const dll = steamApiDllPath();
  const csc = cscPath();
  const cacheDir = join(config.stateDir, "workshop", "legacy");
  const exe = join(cacheDir, "WorkshopLegacy.exe");
  const helper: LegacyHelper | null =
    source !== null && dll !== null && csc !== null
      ? { exe, cacheDir, source, dll, csc }
      : null;
  return {
    source,
    csc,
    dll,
    cacheDir,
    exe,
    built: existsSync(exe),
    stale: helper === null ? true : isStale(helper),
  };
}

/** The helper's wire format: one `key<TAB>base64(UTF-8)` line, repeated for arrays. */
export function encodeLegacyRequest(fields: Record<string, LegacyField>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      lines.push(`${key}\t${Buffer.from(String(item), "utf8").toString("base64")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function parseLegacyResponse(text: string): Record<string, string> {
  const response: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    response[line.slice(0, tab)] = Buffer.from(line.slice(tab + 1), "base64").toString("utf8");
  }
  return response;
}

async function runLegacy(
  config: Config,
  fields: Record<string, LegacyField>,
): Promise<Record<string, string>> {
  const helper = await ensureLegacyHelper(config);
  const id = randomUUID();
  const requestPath = join(helper.cacheDir, `request-${id}.txt`);
  const responsePath = join(helper.cacheDir, `response-${id}.txt`);
  writeFileSync(requestPath, encodeLegacyRequest(fields), "utf8");
  try {
    const result = await run(helper.exe, [requestPath, responsePath], {
      cwd: helper.cacheDir,
      timeoutMs: 45 * 60 * 1000,
      env: { ...process.env, SteamAppId: String(L4D2_CREATOR_APP_ID) },
    });
    if (result.timedOut) {
      throw new Error(
        "The Workshop upload did not finish within 45 minutes. The item may or may not " +
          "have been created or updated; call read_workshop_items before retrying, so a " +
          "retry does not create a duplicate.",
      );
    }
    if (!existsSync(responsePath)) {
      throw new Error(
        `The Workshop helper exited ${String(result.code)} without a response.\n` +
          `${result.stdout}\n${result.stderr}`,
      );
    }
    const response = parseLegacyResponse(readFileSync(responsePath, "utf8"));
    if (response.ok !== "true") {
      throw new Error(
        response.error ??
          `The Workshop helper failed (exit ${String(result.code)}).\n${result.stderr}`,
      );
    }
    return response;
  } finally {
    rmSync(requestPath, { force: true });
    rmSync(responsePath, { force: true });
  }
}

export interface LegacyEnv {
  helperVersion: string;
  quotaRead: boolean;
  quotaTotal: number;
  quotaAvailable: number;
}

/** Reads the Steam Cloud quota the content upload is staged through. */
export async function legacyEnvironment(config: Config): Promise<LegacyEnv> {
  const response = await runLegacy(config, { command: "env" });
  return {
    helperVersion: response.helperVersion ?? "unknown",
    quotaRead: response.quotaRead === "true",
    quotaTotal: Number(response.quotaTotal ?? 0),
    quotaAvailable: Number(response.quotaAvailable ?? 0),
  };
}

export interface LegacyPublishInput {
  vpk: string;
  preview?: string;
  title: string;
  description: string;
  tags: readonly string[];
  visibility: number;
}

export interface LegacyPublishResult {
  itemId: string;
  needsAgreement: boolean;
}

export async function legacyPublish(
  config: Config,
  input: LegacyPublishInput,
): Promise<LegacyPublishResult> {
  const response = await runLegacy(config, {
    command: "publish",
    vpk: input.vpk,
    ...(input.preview === undefined ? {} : { preview: input.preview }),
    title: input.title,
    description: input.description,
    visibility: input.visibility,
    ...(input.tags.length === 0 ? {} : { tag: [...input.tags] }),
  });
  const itemId = response.itemId ?? "";
  if (!/^\d+$/.test(itemId) || itemId === "0") {
    throw new Error(`Steam did not return a published file id (got "${itemId}").`);
  }
  return { itemId, needsAgreement: response.needsAgreement === "true" };
}

export interface LegacyUpdateInput {
  itemId: string;
  vpk?: string;
  preview?: string;
  clearPreview?: boolean;
  title?: string;
  description?: string;
  tags?: readonly string[];
  visibility?: number;
  changeNote?: string;
}

export interface LegacyUpdateResult {
  itemId: string;
  needsAgreement: boolean;
}

export async function legacyUpdate(
  config: Config,
  input: LegacyUpdateInput,
): Promise<LegacyUpdateResult> {
  const fields: Record<string, LegacyField> = {
    command: "update",
    itemId: input.itemId,
  };
  if (input.vpk !== undefined) fields.vpk = input.vpk;
  if (input.preview !== undefined) fields.preview = input.preview;
  if (input.clearPreview === true) fields.clearPreview = true;
  if (input.title !== undefined) fields.title = input.title;
  if (input.description !== undefined) fields.description = input.description;
  if (input.visibility !== undefined) fields.visibility = input.visibility;
  if (input.changeNote !== undefined) fields.changeNote = input.changeNote;
  if (input.tags !== undefined) {
    if (input.tags.length === 0) fields.clearTags = true;
    else fields.tag = [...input.tags];
  }
  const response = await runLegacy(config, fields);
  const itemId = response.itemId ?? input.itemId;
  return { itemId, needsAgreement: response.needsAgreement === "true" };
}
