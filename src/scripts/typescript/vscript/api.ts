/**
 * The Left 4 Dead 2 VScript contract this project checks against.
 *
 * It is deliberately a catalogue, not a proof: the engine is the final authority, and an
 * unknown key or hook is information. What is listed here comes from the shipped mode and
 * Director scripts and from `resource/modevents.res` (read at runtime by `game_events`).
 */

export type VscriptOptionType = "number" | "boolean" | "string";

export interface VscriptOption {
  key: string;
  type: VscriptOptionType;
  note: string;
}

/** Keys read from `DirectorOptions`; `MutationOptions` accepts the same ones. */
export const DIRECTOR_OPTIONS: readonly VscriptOption[] = [
  { key: "A_CustomFinale_StageCount", type: "number", note: "number of custom-finale stages" },
  { key: "TankLimit", type: "number", note: "maximum tanks alive at once" },
  { key: "WitchLimit", type: "number", note: "maximum witches alive at once" },
  { key: "CommonLimit", type: "number", note: "maximum common infected alive" },
  { key: "MobMaxSize", type: "number", note: "largest mob the Director may send" },
  { key: "MegaMobSize", type: "number", note: "size of a mega-mob" },
  { key: "MegaMobMinSize", type: "number", note: "smallest mega-mob" },
  { key: "HordeEscapeCommonLimit", type: "number", note: "commons allowed during an escape horde" },
  { key: "EscapeSpawnTanks", type: "boolean", note: "allow tanks during the escape" },
  { key: "SpecialRespawnInterval", type: "number", note: "seconds before a dead special respawns" },
  { key: "SmokerLimit", type: "number", note: "maximum smokers" },
  { key: "BoomerLimit", type: "number", note: "maximum boomers" },
  { key: "HunterLimit", type: "number", note: "maximum hunters" },
  { key: "SpitterLimit", type: "number", note: "maximum spitters" },
  { key: "JockeyLimit", type: "number", note: "maximum jockeys" },
  { key: "ChargerLimit", type: "number", note: "maximum chargers" },
  { key: "DominatorLimit", type: "number", note: "maximum dominator-class specials" },
  { key: "DoorSpawnLimit", type: "number", note: "specials allowed to spawn from doors" },
  { key: "MaxSpecials", type: "number", note: "total specials for the mission/wave" },
  { key: "MaxConcurrentSpecials", type: "number", note: "simultaneous specials" },
  { key: "MinSpecials", type: "number", note: "minimum specials before the Director is done" },
  { key: "TankSpawnInterval", type: "number", note: "seconds between tank attempts" },
  { key: "WitchSpawnInterval", type: "number", note: "seconds between witch attempts" },
  { key: "MobSpawnSize", type: "number", note: "size of a normal mob" },
  { key: "ShouldAllowSpecialsWithTank", type: "boolean", note: "specials may spawn alongside a tank" },
  { key: "ShouldAllowMobsWithTank", type: "boolean", note: "mobs may spawn alongside a tank" },
  { key: "ProhibitBosses", type: "boolean", note: "disable tanks and witches" },
  { key: "PreferredSpecialDirection", type: "string", note: "direction hint for special spawns" },
];

/** Keys specific to `MutationOptions`; the Director reads them after `DirectorOptions`. */
export const MUTATION_ONLY_OPTIONS: readonly VscriptOption[] = [
  { key: "WanderingZombieDensityModifier", type: "number", note: "scales wandering common density" },
  { key: "TotalSpecials", type: "number", note: "specials the Director may spend" },
  { key: "TotalBoomer", type: "number", note: "boomers in a wave" },
  { key: "TotalSmoker", type: "number", note: "smokers in a wave" },
  { key: "TotalHunter", type: "number", note: "hunters in a wave" },
  { key: "TotalSpitter", type: "number", note: "spitters in a wave" },
  { key: "TotalJockey", type: "number", note: "jockeys in a wave" },
  { key: "TotalCharger", type: "number", note: "chargers in a wave" },
];

/** Hooks that are not `OnGameEvent_<event>`. */
export const NAMED_HOOKS: readonly string[] = [
  "OnMapSpawn",
  "OnBeginCustomFinaleStage",
  "OnSurvivalRoundStarted",
  "OnScavengeRoundStarted",
  "OnPanicEventFinished",
  "OnGameEvent_",
  "OnTakeDamage",
  "OnPlayerTeam",
  "OnChooseTeam",
];

export const OPTION_SPECS: ReadonlyMap<string, VscriptOption> = new Map(
  [...DIRECTOR_OPTIONS, ...MUTATION_ONLY_OPTIONS].map((option) => [option.key, option]),
);

/** The option keys that are documented as numbers; used for quoted-literal warnings. */
export const NUMERIC_OPTION_KEYS: ReadonlySet<string> = new Set(
  [...DIRECTOR_OPTIONS, ...MUTATION_ONLY_OPTIONS]
    .filter((option) => option.type === "number")
    .map((option) => option.key),
);
