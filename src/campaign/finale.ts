/**
 * The finale contract, checked from the entities and the nav dump.
 *
 * A finale compiles and loads long before it works. The failures this catches are the ones
 * that need a play test to see otherwise: a trigger with no script behind it, a custom
 * finale whose stage list is shorter than its stage count, a gauntlet without its flow
 * target, a trigger that is not standing over the FINALE nav area the escape route is
 * computed from, and a trigger that starts disabled with nothing to enable it.
 */

export type Vec3 = [number, number, number];

export interface FinaleEntity {
  classname: string;
  targetname?: string;
  origin?: Vec3;
  /** Every key/value pair. Duplicates are allowed, as in a VMF. */
  keyvalues: Array<[string, string]>;
  /** VMF `connections`; a compiled BSP keeps them among the keyvalues. */
  connections: Array<[string, string]>;
  solidCount: number;
}

export interface FinaleRegion {
  lo: Vec3;
  hi: Vec3;
}

export interface FinaleNavArea {
  center: Vec3;
  attributes: string[];
}

export interface FinaleInput {
  /** Map name without a path, used for the automatic `<map>_finale.nut`. */
  map: string;
  entities: readonly FinaleEntity[];
  /** FINALE regions from `func_nav_attribute_region` solids, when the VMF is available. */
  finaleRegions?: readonly FinaleRegion[];
  /** Areas from a nav dump, when one is available. */
  navAreas?: readonly FinaleNavArea[];
  /** Script text, when it could be read. `null` means "looked and did not find it". */
  scriptText?: string | null;
  /** The script name the caller resolved, for the message. */
  scriptName?: string;
  /** Whether this map is the campaign's last chapter. */
  expectFinale: boolean;
}

export interface FinaleFinding {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
  entity?: string;
}

export interface FinaleReport {
  findings: FinaleFinding[];
  ok: boolean;
  type: number | null;
  scriptName: string | null;
  triggerCount: number;
  finaleNavAreas: number;
  overFinaleNav: boolean | null;
  stageCount: number | null;
  definedStages: number;
}

const FINALE_BIT = 0x40;
const CHECKPOINT_BIT = 0x800;

/** Entity keys are case-insensitive in this engine; the first spelling wins. */
export function key(entity: FinaleEntity, name: string): string | undefined {
  const lower = name.toLowerCase();
  return entity.keyvalues.find(([k]) => k.toLowerCase() === lower)?.[1];
}

function intKey(entity: FinaleEntity, name: string, fallback: number): number {
  const raw = key(entity, name);
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function outputs(entity: FinaleEntity): string[] {
  const fromConnections = entity.connections.map(([name]) => name);
  const fromKeyvalues = entity.keyvalues
    .filter(([name, value]) => /^(On|Out|[A-Z])/.test(name) && value.includes(","))
    .map(([name]) => name);
  return [...new Set([...fromConnections, ...fromKeyvalues])];
}

function scriptFileOf(entity: FinaleEntity): string | null {
  const raw = (key(entity, "ScriptFile") ?? "").trim();
  if (raw === "") return null;
  return raw.replace(/\\/g, "/").replace(/^scripts\/vscripts\//, "").replace(/\.nut$/i, "");
}

/** Counts `A_CustomFinaleN` entries and reads `A_CustomFinale_StageCount`. */
export function readCustomStages(text: string): {
  stageCount: number | null;
  definedStages: number;
  hasDirectorOptions: boolean;
  hasStageHook: boolean;
} {
  const defined = new Set<number>();
  for (const match of text.matchAll(/\bA_CustomFinale(\d+)\s*=/g)) {
    defined.add(Number.parseInt(match[1]!, 10));
  }
  const stage = /\bA_CustomFinale_StageCount\s*=\s*(\d+)/.exec(text);
  return {
    stageCount: stage ? Number.parseInt(stage[1]!, 10) : null,
    definedStages: defined.size,
    hasDirectorOptions: /\bDirectorOptions\s*<-/.test(text) || /\bDirectorOptions\s*=/.test(text),
    hasStageHook: /\bfunction\s+OnBeginCustomFinaleStage\s*\(/.test(text),
  };
}

/**
 * Whether the trigger stands over a FINALE area.
 *
 * With the VMF, the region brush is the answer: it is what the attribute region actually
 * covers. From a compiled map only the nav centres remain, so the test becomes "a FINALE
 * centre within one cell", and it says so by returning `null` when neither source exists.
 */
function overFinale(
  origin: Vec3,
  regions: readonly FinaleRegion[] | undefined,
  areas: readonly FinaleNavArea[] | undefined,
): boolean | null {
  if (regions && regions.length > 0) {
    return regions.some(
      (r) =>
        r.lo[0] <= origin[0] &&
        origin[0] <= r.hi[0] &&
        r.lo[1] <= origin[1] &&
        origin[1] <= r.hi[1] &&
        origin[2] >= r.lo[2] - 8 &&
        origin[2] <= r.hi[2] + 8,
    );
  }
  const finale = (areas ?? []).filter((a) => a.attributes.includes("finale"));
  if (finale.length === 0) return null;
  return finale.some(
    (a) =>
      Math.abs(a.center[0] - origin[0]) <= 96 &&
      Math.abs(a.center[1] - origin[1]) <= 96 &&
      origin[2] >= a.center[2] - 8,
  );
}

export function checkFinale(input: FinaleInput): FinaleReport {
  const findings: FinaleFinding[] = [];
  const add = (
    severity: FinaleFinding["severity"],
    rule: string,
    message: string,
    entity?: string,
  ): void => {
    findings.push({ severity, rule, message, ...(entity ? { entity } : {}) });
  };

  const triggers = input.entities.filter((e) => e.classname === "trigger_finale");
  const finaleNavAreas = (input.navAreas ?? []).filter((a) =>
    a.attributes.includes("finale"),
  ).length;

  if (triggers.length === 0) {
    if (input.expectFinale) {
      add(
        "error",
        "finale-missing-trigger",
        "this is the campaign's last chapter and there is no trigger_finale; nothing can " +
          "start a finale, and the escape never becomes available",
      );
    }
  }
  if (triggers.length > 1) {
    add(
      "warning",
      "finale-multiple-triggers",
      `${triggers.length} trigger_finale entities; the Director expects one per map and more ` +
        "than one escape route produces conflicting goals",
    );
  }
  if (triggers.length === 0) {
    return {
      findings,
      ok: findings.every((f) => f.severity !== "error"),
      type: null,
      scriptName: null,
      triggerCount: 0,
      finaleNavAreas,
      overFinaleNav: null,
      stageCount: null,
      definedStages: 0,
    };
  }

  const trigger = triggers[0]!;
  const type = intKey(trigger, "type", 0);
  const origin = trigger.origin;
  const triggerName = trigger.targetname ?? `trigger_finale at ${origin?.join(" ") ?? "?"}`;

  if (![0, 1, 2, 4].includes(type)) {
    add(
      "error",
      "finale-bad-type",
      `trigger_finale type ${type} is not a finale type this game ships (0 standard, ` +
        "1 gauntlet, 2 custom, 4 scavenge)",
      triggerName,
    );
  }

  const over = origin ? overFinale(origin, input.finaleRegions, input.navAreas) : null;
  if (over === false) {
    add(
      "error",
      "finale-trigger-outside-nav",
      "the trigger is not over a FINALE nav area; the escape route is chosen from the FINALE " +
        "areas, so the trigger and the route disagree",
      triggerName,
    );
  } else if (over === null) {
    add(
      "warning",
      "finale-nav-unchecked",
      "no FINALE region or nav dump was supplied, so the trigger's position against the nav " +
        "mesh was not checked",
      triggerName,
    );
  }
  if (input.navAreas && finaleNavAreas === 0) {
    add(
      "error",
      "finale-no-nav-area",
      "the nav dump has no FINALE area; the Director has no finale goal and the escape route " +
        "ends at the wrong place",
    );
  }

  const escape = outputs(trigger);
  if (!escape.includes("FinaleEscapeStarted")) {
    add(
      "warning",
      "finale-no-escape-output",
      "nothing is wired to `FinaleEscapeStarted`; the map can start the finale and still have " +
        "no escape trigger, vehicle or door that the event opens",
      triggerName,
    );
  }

  // A custom finale's script is one check among the finale's checks, not a reason to skip
  // the rest: a type-2 trigger can still start disabled, lack its outtro, or point at a
  // script whose stage list is short. The old early return meant only the script was
  // reported and everything after it was silently unexamined.
  let scriptNameOut: string | null = scriptFileOf(trigger);
  let stageCount: number | null = null;
  let definedStages = 0;
  if (type === 2) {
    const scriptName = scriptFileOf(trigger) ?? `${input.map}_finale`;
    const resolved = input.scriptName ?? `${scriptName}.nut`;
    scriptNameOut = resolved;
    if (input.scriptText === undefined) {
      add(
        "warning",
        "finale-script-not-checked",
        `custom finale uses scripts/vscripts/${resolved}, but no script directory or VPK was ` +
          "supplied, so the file and its stage list were not checked",
        triggerName,
      );
    } else if (input.scriptText === null) {
      add(
        "error",
        "finale-missing-script",
        `custom finale wants scripts/vscripts/${resolved}, and it was not found`,
        triggerName,
      );
    } else {
      const script = readCustomStages(input.scriptText);
      stageCount = script.stageCount;
      definedStages = script.definedStages;
      if (!script.hasDirectorOptions) {
        add(
          "warning",
          "finale-script-no-options",
          `${resolved} has no DirectorOptions table; a custom finale with no stage list does ` +
            "not advance",
          triggerName,
        );
      }
      if (script.stageCount === null) {
        add(
          "warning",
          "finale-script-no-stage-count",
          `${resolved} has no A_CustomFinale_StageCount; the Director cannot tell how many ` +
            "stages the finale has",
          triggerName,
        );
      } else if (script.stageCount > script.definedStages) {
        add(
          "error",
          "finale-script-stage-count",
          `${resolved} declares ${script.stageCount} stages but defines ${script.definedStages} ` +
            "A_CustomFinaleN entries; the finale stops at the first missing stage",
          triggerName,
        );
      }
      if (!script.hasStageHook) {
        add(
          "info",
          "finale-script-no-stage-hook",
          `${resolved} has no OnBeginCustomFinaleStage function; stages still run, but nothing ` +
            "can log or react to them",
          triggerName,
        );
      }
    }
  }

  if (type === 1) {
    const flow = input.entities.find(
      (e) => e.classname === "info_target" && (e.targetname ?? "") === "nav_flow_target",
    );
    if (!flow) {
      add(
        "error",
        "finale-gauntlet-no-flow-target",
        "a gauntlet finale needs `info_target nav_flow_target` near the rescue vehicle; without " +
          "it the flow lets infected spawn behind the survivors",
        triggerName,
      );
    }
  }

  if (!input.entities.some((e) => e.classname === "env_outtro_stats")) {
    add(
      "warning",
      "finale-no-outtro-stats",
      "no env_outtro_stats; the finale can be won and the mission credits still not run",
      triggerName,
    );
  }

  if (input.expectFinale) {
    const arrivals = input.entities.filter((e) => e.classname === "info_changelevel");
    if (arrivals.length === 0) {
      add(
        "warning",
        "finale-no-arrival-changelevel",
        "no info_changelevel; the finale map is missing the disabled arrival marker, and the " +
          "Director can report 'No exit checkpoint could be found' instead of starting",
      );
    } else if (!arrivals.some((e) => (intKey(e, "spawnflags", 0) & 2) !== 0)) {
      add(
        "warning",
        "finale-arrival-not-disabled",
        "info_changelevel exists but none carries spawnflags 2 (disabled); an active arrival " +
          "changelevel can send the survivors back to the previous chapter",
      );
    }
  }

  const disabled = (intKey(trigger, "StartDisabled", 0) & 1) !== 0;
  if (disabled) {
    const enabled = input.entities.some((e) =>
      [...e.connections, ...e.keyvalues].some(
        ([name, value]) =>
          /^(Enable|ForceFinaleStart)$/i.test(value.split(",")[1]?.trim() ?? "") &&
          value.split(",")[0]?.trim() === (trigger.targetname ?? ""),
      ),
    );
    if (!enabled) {
      add(
        "warning",
        "finale-start-disabled",
        "the trigger starts disabled and nothing enables it; the finale cannot be started by " +
          "a player",
        triggerName,
      );
    }
  }

  const checkpointAreas = (input.navAreas ?? []).filter((a) =>
    a.attributes.includes("checkpoint"),
  ).length;
  if (input.navAreas && checkpointAreas === 0) {
    add(
      "warning",
      "finale-no-checkpoint",
      "the nav dump has no CHECKPOINT area; a finale map still needs the arrival checkpoint " +
        "the survivors start from",
    );
  }

  return finish({
    findings,
    triggerCount: triggers.length,
    type,
    scriptName: scriptNameOut,
    finaleNavAreas,
    overFinaleNav: over,
    stageCount,
    definedStages,
  });
}

function finish(
  report: Omit<FinaleReport, "ok">,
): FinaleReport {
  return {
    ...report,
    ok: report.findings.every((f) => f.severity !== "error"),
  };
}

/** Exported for tests: the bit values this checker names. */
export const FINALE_NAV_BIT = FINALE_BIT;
export const CHECKPOINT_NAV_BIT = CHECKPOINT_BIT;
