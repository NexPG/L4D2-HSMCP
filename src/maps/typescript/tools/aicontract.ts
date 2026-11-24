/**
 * AI/nav content contract: the entity half and the nav half of "where can bots go".
 *
 * `info_survivor_rescue` is a point in a rescue closet; the closet itself is a nav area with
 * the RESCUE_CLOSET spawn attribute. One without the other is a half-built rescue: official
 * `c1m1_hotel` has 6 points and 4 closet areas, `c2m5_concert` 3 and 5, and a finale map
 * such as `c5m5_bridge` has neither. `info_remarkable` fires a `TLK_REMARK` when a survivor
 * sees it, and `func_nav_blocker` cuts nav areas out of an AABB.
 *
 * This reads the entity lump and, when a `.nav` is given, the nav records. It counts hiding
 * spots by their flag byte; it does not simulate a bot and does not prove a line is heard.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readMapEntities } from "../entity/read.js";
import { HIDING_SPOT_FLAGS, readNavFile } from "../../../nav/typescript/formats/navfile.js";

const RESCUE_CLOSET = 0x00010000;

interface Finding {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
}

export interface AiContract {
  path: string;
  source: "vmf" | "bsp";
  navPath: string | null;
  entities: {
    rescuePoints: number;
    remarkables: number;
    remarkablesWithSubject: number;
    navBlockers: number;
    avoidanceObstacles: number;
  };
  nav: {
    areas: number;
    rescueClosetAreas: number;
    hidingSpots: number;
    inCover: number;
    exposed: number;
    goodSniperSpots: number;
    idealSniperSpots: number;
  } | null;
  findings: Finding[];
  verdict: "pass" | "warn" | "fail";
}

function defaultNav(path: string): string | null {
  const stem = basename(path, extname(path));
  const candidates =
    extname(path).toLowerCase() === ".bsp"
      ? [join(dirname(path), `${stem}.nav`), join(dirname(path), "nav", `${stem}.nav`)]
      : [join(dirname(path), "..", "nav", `${stem}.nav`), join(dirname(path), `${stem}.nav`)];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function checkAiContract(path: string, options: { nav?: string } = {}): AiContract {
  const entities = readMapEntities(path);
  const count = (classname: string): number =>
    entities.filter((entity) => entity.classname === classname).length;
  const remarkables = entities.filter((entity) => entity.classname === "info_remarkable");
  const subjectOf = (entity: (typeof entities)[number]): string =>
    entity.keyvalues.find(([key]) => key.toLowerCase() === "contextsubject")?.[1]?.trim() ?? "";
  const remarkablesWithSubject = remarkables.filter((entity) => subjectOf(entity) !== "").length;

  const navPath = options.nav ?? defaultNav(path);
  let nav: AiContract["nav"] = null;
  if (navPath !== null) {
    if (!existsSync(navPath)) throw new Error(`${navPath} does not exist`);
    const file = readNavFile(readFileSync(navPath), navPath);
    const counts: Record<string, number> = {};
    let hidingSpots = 0;
    for (const area of file.areas) {
      for (const spot of area.hidingSpotList) {
        hidingSpots += 1;
        for (const [bit, name] of Object.entries(HIDING_SPOT_FLAGS)) {
          if ((spot.flags & Number(bit)) !== 0) counts[name] = (counts[name] ?? 0) + 1;
        }
      }
    }
    nav = {
      areas: file.areas.length,
      rescueClosetAreas: file.areas.filter((area) => (area.spawnAttributes & RESCUE_CLOSET) !== 0)
        .length,
      hidingSpots,
      inCover: counts["IN_COVER"] ?? 0,
      exposed: counts["EXPOSED"] ?? 0,
      goodSniperSpots: counts["GOOD_SNIPER_SPOT"] ?? 0,
      idealSniperSpots: counts["IDEAL_SNIPER_SPOT"] ?? 0,
    };
  }

  const findings: Finding[] = [];
  const rescuePoints = count("info_survivor_rescue");
  if (nav !== null) {
    if (rescuePoints > 0 && nav.rescueClosetAreas === 0) {
      findings.push({
        severity: "error",
        rule: "rescue-without-closet",
        message:
          `${rescuePoints} info_survivor_rescue point(s) but no nav area with RESCUE_CLOSET; ` +
          "the survivors have nowhere to wait and the closet is not a rescue",
      });
    }
    if (nav.rescueClosetAreas > 0 && rescuePoints === 0) {
      findings.push({
        severity: "warning",
        rule: "closet-without-point",
        message:
          `${nav.rescueClosetAreas} RESCUE_CLOSET nav area(s) but no info_survivor_rescue; ` +
          "the nav says this is a rescue but no survivor is placed",
      });
    }
    if (nav.hidingSpots === 0) {
      findings.push({
        severity: "info",
        rule: "no-hiding-spots",
        message:
          "the nav has no hiding spots; bots have nowhere to ambush, which is normal on a " +
          "small arena and unusual on a full chapter",
      });
    }
  } else {
    findings.push({
      severity: "info",
      rule: "nav-not-read",
      message:
        "no .nav was given or found beside the map; only the entity half was checked",
    });
  }

  if (remarkables.length > 0 && remarkablesWithSubject === 0) {
    findings.push({
      severity: "info",
      rule: "remarkable-no-subject",
      message:
        `${remarkables.length} info_remarkable entity/entities have no contextsubject; the ` +
        "TLK_REMARK fires without a subject line",
    });
  }

  return {
    path,
    source: extname(path).toLowerCase() === ".vmf" ? "vmf" : "bsp",
    navPath,
    entities: {
      rescuePoints,
      remarkables: remarkables.length,
      remarkablesWithSubject,
      navBlockers: count("func_nav_blocker"),
      avoidanceObstacles: count("func_nav_avoidance_obstacle"),
    },
    nav,
    findings,
    verdict: findings.some((finding) => finding.severity === "error")
      ? "fail"
      : findings.some((finding) => finding.severity === "warning")
        ? "warn"
        : "pass",
  };
}

export const checkAiContractTool = defineTool({
  name: "check_ai_contract",
  description:
    "Checks the AI/nav content of a map without launching the game: `info_survivor_rescue` " +
    "points against RESCUE_CLOSET nav areas, `info_remarkable` count and contextsubject, " +
    "`func_nav_blocker`/`func_nav_avoidance_obstacle` brushes, and nav hiding spots by flag " +
    "(IN_COVER, EXPOSED, sniper spots). Reads a VMF or BSP; finds a sibling `.nav` when one " +
    "is not given. A counting check, not a bot simulation.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Map .vmf or .bsp, absolute or relative to the repo root."),
    nav: z
      .string()
      .optional()
      .describe("Optional .nav. Default: a sibling `<map>.nav` or `<dir>/nav/<map>.nav`."),
  },
  outputSchema: {
    path: z.string(),
    source: z.enum(["vmf", "bsp"]),
    navPath: z.string().nullable(),
    entities: z.object({
      rescuePoints: z.number(),
      remarkables: z.number(),
      remarkablesWithSubject: z.number(),
      navBlockers: z.number(),
      avoidanceObstacles: z.number(),
    }),
    nav: z
      .object({
        areas: z.number(),
        rescueClosetAreas: z.number(),
        hidingSpots: z.number(),
        inCover: z.number(),
        exposed: z.number(),
        goodSniperSpots: z.number(),
        idealSniperSpots: z.number(),
      })
      .nullable(),
    findings: z.array(
      z.object({
        severity: z.enum(["error", "warning", "info"]),
        rule: z.string(),
        message: z.string(),
      }),
    ),
    verdict: z.enum(["pass", "warn", "fail"]),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const nav = args.nav !== undefined ? resolveInput(args.nav, ctx.config) : undefined;
    return checkAiContract(path, { ...(nav !== undefined ? { nav } : {}) }) as unknown as Record<
      string,
      unknown
    >;
  },
});

export const aiContractTools = [checkAiContractTool];
