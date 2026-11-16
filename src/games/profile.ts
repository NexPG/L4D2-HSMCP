/**
 * The game profile: which Source game a tool is working against.
 *
 * This fork targets **Left 4 Dead 2 only**, so the table below has exactly one entry. It
 * still carries the same three layers and the same provenance discipline, because the
 * values that matter are read off disk rather than asserted:
 *
 * 1. **Built-in** -- only what cannot be read from disk: the Steam appid, the install
 *    directory, the mod directory. Deliberately thin.
 * 2. **Discovery** (`./steam.ts`) -- the absolute paths, the display name, the FGD list,
 *    which binaries exist. Read from Steam's files and the game's own `gameinfo.txt`.
 * 3. **Configuration** -- `gameProfiles.l4d2` in `.hammer-mcp/config.json`.
 *
 * The `provenance` field is not decoration. Nothing about this game's toolchain has been
 * measured here yet, so a caller must be able to tell "this FGD name came out of
 * gameinfo.txt" from "this mod directory is a built-in guess nobody has run".
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { discoverSourceInstalls } from "./steam.js";
import type { SourceInstall } from "./steam.js";

/**
 * Engine branch. L4D2 is Source 2009; it is the only branch this fork resolves. Kept as a
 * named type so a future per-branch limit table has something to key on, and so the
 * output says which branch the numbers were judged against.
 */
export type EngineBranch = "l4d2";

export interface Provenance {
  /** Where the value came from: a file and key, or the layer that supplied it. */
  source: string;
  /** True when a file on this machine was read, or a path was checked to exist. */
  verified: boolean;
}

/** A built-in entry: strictly what discovery cannot produce. */
export interface BuiltinProfile {
  id: string;
  displayName: string;
  steamAppId: number;
  /** Directory under `steamapps/common/`. */
  installDir: string;
  /** The `-game` directory's last component. */
  modDir: string;
  branch: EngineBranch;
  /** Why anything here is or is not trustworthy. */
  note?: string;
}

export interface ResolvedGame {
  id: string;
  displayName: string;
  branch: EngineBranch;
  steamAppId: number | null;
  /** Root of the install. Null when the game was never found and nothing configured it. */
  gameRoot: string | null;
  /** The `-game` argument. */
  gameDir: string | null;
  /** Where the stock compilers and the .fgd files live. */
  binDir: string | null;
  /** Where the Tools++ compilers live, when that is known. */
  plusPlusBinDir: string | null;
  /** FGD file names, relative to `binDir`, as the game itself declares them. */
  fgd: string[];
  /** Extra FGDs loaded only when present. */
  optionalFgd: string[];
  /** `InstancePath` from gameinfo.txt, where func_instance files resolve from. */
  instancePath: string | null;
  /** Non-null when this profile cannot drive a compile, and why. */
  unusableForCompile: string | null;
  provenance: Record<string, Provenance>;
}

/** Per-profile overrides accepted in the config file. */
export const GameProfileOverride = z
  .object({
    gameRoot: z.string(),
    gameDir: z.string(),
    binDir: z.string(),
    plusPlusBinDir: z.string(),
    fgd: z.array(z.string()),
    optionalFgd: z.array(z.string()),
    branch: z.enum(["l4d2"]),
    modDir: z.string(),
    steamAppId: z.number().int(),
  })
  .partial();
export type GameProfileOverride = z.infer<typeof GameProfileOverride>;

/**
 * The built-in table, kept as small as honesty allows.
 *
 * Left 4 Dead 2 has not been run by this fork yet. The entry therefore carries only what
 * is true without a measurement: the appid, the install directory and the mod directory.
 * No FGD name, no Hammer++ directory, no lump ceiling -- those three are the kind of fact
 * that is wrong loudly when read from disk and wrong silently when guessed.
 */
export const BUILTIN_PROFILES: readonly BuiltinProfile[] = [
  {
    id: "l4d2",
    displayName: "Left 4 Dead 2",
    steamAppId: 550,
    installDir: "Left 4 Dead 2",
    modDir: "left4dead2",
    branch: "l4d2",
    note: "The only target of this fork. Nothing about its toolchain is measured yet.",
  },
] as const;

function fromBuiltin(b: BuiltinProfile): ResolvedGame {
  return {
    id: b.id,
    displayName: b.displayName,
    branch: b.branch,
    steamAppId: b.steamAppId,
    gameRoot: null,
    gameDir: null,
    binDir: null,
    plusPlusBinDir: null,
    fgd: [],
    optionalFgd: [],
    instancePath: null,
    unusableForCompile: `${b.displayName} was not found on this machine`,
    provenance: {
      steamAppId: { source: "builtin table", verified: false },
      modDir: { source: "builtin table", verified: false },
      branch: { source: "builtin table", verified: false },
    },
  };
}

/** Fills a profile in from what discovery actually found on disk. */
function applyDiscovery(base: ResolvedGame, b: BuiltinProfile, install: SourceInstall): void {
  const gameRoot = install.app.gameRoot as string;
  const mod =
    install.mods.find((m) => m.dir === b.modDir) ??
    install.mods.find((m) => m.steamAppId === b.steamAppId) ??
    install.mods[0];

  base.gameRoot = gameRoot;
  base.displayName = mod?.displayName ?? install.app.name;
  base.provenance["displayName"] = {
    source: mod?.displayName ? "gameinfo.txt:game" : "appmanifest:name",
    verified: true,
  };

  if (mod) {
    base.gameDir = join(gameRoot, mod.dir);
    base.fgd = mod.fgd;
    base.instancePath = mod.instancePath;
    base.provenance["gameDir"] = { source: "steamapps/common + gameinfo.txt", verified: true };
    base.provenance["fgd"] = { source: "gameinfo.txt:GameData", verified: mod.fgd.length > 0 };
    if (mod.instancePath) {
      base.provenance["instancePath"] = { source: "gameinfo.txt:InstancePath", verified: true };
    }
  }

  base.binDir = install.stock.dir;
  if (install.stock.dir) {
    base.provenance["binDir"] = { source: "steamapps/common/<game>/bin", verified: true };
  }

  base.unusableForCompile = compileBlocker(base);
}

function compileBlocker(g: ResolvedGame): string | null {
  if (!g.gameDir) return `no mod directory found for ${g.id}; nothing to pass as -game`;
  if (!g.binDir) {
    return (
      `${g.displayName} has no bin/ directory. Several Source games ship their compilers ` +
      `in a separate app; point gameProfiles.${g.id}.binDir at them.`
    );
  }
  if (!existsSync(join(g.binDir, "vbsp.exe"))) {
    return (
      `no vbsp.exe in ${g.binDir}. The compilers ship with the game client, never with a ` +
      `dedicated server.`
    );
  }
  return null;
}

function applyOverride(g: ResolvedGame, o: GameProfileOverride, source: string): void {
  const set = <K extends keyof ResolvedGame>(key: K, value: ResolvedGame[K]): void => {
    g[key] = value;
    g.provenance[key as string] = { source, verified: true };
  };
  if (o.gameRoot !== undefined) set("gameRoot", o.gameRoot);
  if (o.gameDir !== undefined) set("gameDir", o.gameDir);
  if (o.binDir !== undefined) set("binDir", o.binDir);
  if (o.plusPlusBinDir !== undefined) set("plusPlusBinDir", o.plusPlusBinDir);
  if (o.fgd !== undefined) set("fgd", o.fgd);
  if (o.optionalFgd !== undefined) set("optionalFgd", o.optionalFgd);
  if (o.branch !== undefined) set("branch", o.branch);
  if (o.steamAppId !== undefined) set("steamAppId", o.steamAppId);
  g.unusableForCompile = compileBlocker(g);
}

/**
 * Resolves the only profile this fork knows against this machine.
 *
 * Other Source games that happen to be installed are ignored: there is no profile for
 * them, and inventing one from a discovered mod directory would let a tool answer about a
 * game this server never claimed to support.
 */
export function resolveProfiles(
  overrides: Record<string, GameProfileOverride> = {},
  installs: SourceInstall[] = discoverSourceInstalls(),
): Record<string, ResolvedGame> {
  const out: Record<string, ResolvedGame> = {};

  for (const b of BUILTIN_PROFILES) {
    const g = fromBuiltin(b);
    const install = installs.find((i) => i.app.appId === b.steamAppId);
    if (install) applyDiscovery(g, b, install);
    out[b.id] = g;
  }

  for (const [id, o] of Object.entries(overrides)) {
    const g = out[id];
    if (g) applyOverride(g, o, `config: gameProfiles.${id}`);
  }

  return out;
}
