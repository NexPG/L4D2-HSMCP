/**
 * Choosing the game profile for one tool call.
 *
 * Two rules hold the file together:
 *
 * - **The profile is Left 4 Dead 2, and an unknown id throws.** Falling back to the one
 *   profile would answer a question nobody asked; a caller who names another game is told
 *   that this fork does not support it, rather than silently getting an L4D2 answer.
 * - **Discovery is lazy and memoised.** `loadConfig` stays a file read; scanning Steam
 *   libraries happens the first time a tool actually needs the game.
 */
import { join } from "node:path";
import type { Config } from "../config.js";
import type { ResolvedGame } from "./profile.js";
import { resolveProfiles } from "./profile.js";

/** The only game this fork resolves. */
export const GAME_ID = "l4d2";

export class UnknownGameError extends Error {
  constructor(id: string, known: string[]) {
    super(
      `unknown game "${id}": this fork targets Left 4 Dead 2 only (known: ${known.join(", ")}). ` +
        `Run read_source_games to see what is installed.`,
    );
    this.name = "UnknownGameError";
  }
}

const CACHE = new WeakMap<Config, Record<string, ResolvedGame>>();

/** The profiles this machine knows about, resolved once per Config object. */
export function allGames(config: Config): Record<string, ResolvedGame> {
  const cached = CACHE.get(config);
  if (cached) return cached;

  const games = resolveProfiles(config.gameProfiles ?? {});
  CACHE.set(config, games);
  return games;
}

/**
 * The profile a tool call should work against.
 *
 * `id` is what the caller asked for; absent, the one supported game is used. `from` lets
 * a tool report which of the two happened, so "this is an L4D2 answer" never has to be
 * inferred from the paths.
 */
export function gameFor(
  config: Config,
  id?: string,
): { game: ResolvedGame; from: "argument" | "config" } {
  const games = allGames(config);
  const wanted = id ?? GAME_ID;
  const game = games[wanted];
  if (!game) throw new UnknownGameError(wanted, Object.keys(games).sort());
  return { game, from: id ? "argument" : "config" };
}

/** The shape every game-aware tool puts in its output. */
export function gameBlock(
  game: ResolvedGame,
  from: "argument" | "config",
): {
  id: string;
  displayName: string;
  branch: string;
  gameDir: string | null;
  binDir: string | null;
  from: "argument" | "config";
} {
  return {
    id: game.id,
    displayName: game.displayName,
    branch: game.branch,
    gameDir: game.gameDir,
    binDir: game.binDir,
    from,
  };
}

/**
 * The FGDs to check a map against, as paths relative to `binDir`.
 *
 * Required ones come from the game's own `gameinfo.txt`. Optional ones are added only
 * when the file is there, and reported either way, so a lint never widens its schema
 * without saying so.
 */
export function fgdNamesFor(game: ResolvedGame, exists: (p: string) => boolean): string[] {
  if (!game.binDir) return [];
  return [
    ...game.fgd,
    ...game.optionalFgd.filter((rel) => exists(join(game.binDir as string, rel))),
  ];
}
