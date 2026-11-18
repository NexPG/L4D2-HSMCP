import { z } from "zod";
import { discoverSourceInstalls, libraryPaths, steamRoots } from "../games/steam.js";
import { GAME_ID } from "../games/resolve.js";
import { BUILTIN_PROFILES } from "../games/profile.js";
import { defineTool } from "../mcp/registry.js";

/** The one Steam app this fork cares about. */
const L4D2_APPID = BUILTIN_PROFILES[0]!.steamAppId;

export const readSourceGames = defineTool({
  name: "read_source_games",
  description:
    "Left 4 Dead 2 as installed here, discovered from Steam's own files rather than from " +
    "a hard-coded path: libraryfolders.vdf for the libraries, appmanifest_550.acf for the " +
    "app, and left4dead2/gameinfo.txt for its name, its SteamAppId, its .fgd files and its " +
    "instance path. Reports which stock compilers are present. This fork supports no " +
    "other game, so other Source installs are not listed.",
  realm: "local",
  inputSchema: {},
  outputSchema: {
    steamRoots: z.array(z.string()).describe("Deduplicated by realpath: ~/.steam/steam is usually a symlink."),
    libraries: z.array(z.string()),
    game: z.string().describe(`The one profile this fork resolves: ${GAME_ID}.`),
    games: z.array(
      z.object({
        appId: z.number(),
        name: z.string(),
        gameRoot: z.string(),
        betaBranch: z.string().nullable().describe("Steam's beta key for this install, if any."),
        mods: z.array(
          z.object({
            dir: z.string().describe("The -game argument's last component: left4dead2."),
            gameDir: z.string().describe("Absolute path to pass as -game."),
            displayName: z.string().nullable(),
            steamAppId: z.number().nullable(),
            fgd: z.array(z.string()).describe("Declared by gameinfo.txt's GameData. Empty means it declares none."),
            instancePath: z.string().nullable(),
          }),
        ),
        toolchain: z.object({
          dir: z.string().nullable(),
          binaries: z.record(z.boolean()),
          complete: z.boolean(),
        }),
      }),
    ),
    note: z.string(),
  },
  handler: (_args, _ctx) => {
    const roots = steamRoots();
    const libraries = [...new Set(roots.flatMap(libraryPaths))];
    const installs = discoverSourceInstalls().filter((i) => i.app.appId === L4D2_APPID);

    return {
      steamRoots: roots,
      libraries,
      game: GAME_ID,
      games: installs.map((i) => ({
        appId: i.app.appId,
        name: i.app.name,
        gameRoot: i.app.gameRoot as string,
        betaBranch: i.app.betaKey,
        mods: i.mods.map((m) => ({
          dir: m.dir,
          gameDir: `${i.app.gameRoot}/${m.dir}`,
          displayName: m.displayName,
          steamAppId: m.steamAppId,
          fgd: m.fgd,
          instancePath: m.instancePath,
        })),
        toolchain: i.stock,
      })),
      note:
        installs.length === 0
          ? "Left 4 Dead 2 was not found in any Steam library. The compilers and FGDs " +
            "ship with the game client, not with a dedicated server."
          : "Presence is read from disk; nothing here claims a binary will run. " +
            "Tools++ is a separate standalone install and is reported by health, not here.",
    };
  },
});

export const gameTools = [readSourceGames];
