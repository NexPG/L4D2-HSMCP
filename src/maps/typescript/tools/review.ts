import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { GAME, resolveInput, resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { navTroubleReport } from "../../../nav/typescript/tools/navtrouble.js";
import { readVmfRoomsTool } from "../../../scripts/typescript/tools/scene.js";
import { readMapDependenciesTool } from "./deps.js";
import { readLightmapBudgetTool } from "./lightmap.js";
import { readVmfSightlinesTool } from "./measurespace.js";
import { readMapOrganisationTool } from "./organise.js";
import { readMapReportTool } from "./report.js";
import { checkVmfRulesTool } from "./rules.js";
import { readVisleafStatsTool } from "./visleaf.js";
import { readVmfLint } from "./vmf.js";

const TOP = z.object({ rule: z.string(), severity: z.string(), message: z.string() });

const LINT = z.object({
  ran: z.boolean(),
  ok: z.boolean(),
  error: z.string().nullable(),
  total: z.number(),
  errors: z.number(),
  warnings: z.number(),
  byRule: z.record(z.number()),
  top: z.array(TOP),
});

const RULES = z.object({
  ran: z.boolean(),
  ok: z.boolean(),
  error: z.string().nullable(),
  overall: z.enum(["pass", "warn", "fail", "skipped"]),
  errors: z.number(),
  warnings: z.number(),
  matchedNothing: z.array(z.string()),
});

const ORGANISATION = z.object({
  ran: z.boolean(),
  ok: z.boolean(),
  error: z.string().nullable(),
  visgroups: z.number(),
  groups: z.number(),
  cordonsActive: z.boolean(),
  solidsInNoVisgroup: z.number(),
  solidsInNoGroup: z.number(),
});

const ROOMS = z.object({
  ran: z.boolean(),
  ok: z.boolean(),
  error: z.string().nullable(),
  sealed: z.boolean(),
  roomCount: z.number(),
  unreachable: z.number(),
});

const SIGHTLINES = z.object({
  ran: z.boolean(),
  ok: z.boolean(),
  error: z.string().nullable(),
  pairsTested: z.number(),
  longestUnits: z.number().nullable(),
});

const REPORT = z.object({
  ran: z.boolean(),
  ok: z.boolean(),
  error: z.string().nullable(),
  overall: z.enum(["pass", "warn", "fail", "skipped"]),
  pass: z.number(),
  warn: z.number(),
  fail: z.number(),
  skipped: z.number(),
});

const LIGHTMAP = z.object({
  ran: z.boolean(),
  ok: z.boolean(),
  error: z.string().nullable(),
  totalLuxels: z.number(),
  facesWithLightmap: z.number(),
});

const VISLEAF = z.object({
  ran: z.boolean(),
  ok: z.boolean(),
  error: z.string().nullable(),
  leafCount: z.number(),
  clusterCount: z.number().nullable(),
});

const DEPS = z.object({
  ran: z.boolean(),
  ok: z.boolean(),
  error: z.string().nullable(),
  missing: z.number(),
  loose: z.number(),
  packedUnreferenced: z.number(),
});

const NAV = z.object({
  ran: z.boolean(),
  ok: z.boolean(),
  error: z.string().nullable(),
  verdict: z.enum(["pass", "fail", "warn", "unknown"]),
  failures: z.number(),
});

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One call that runs the audits a mapper would run by hand, and says which of them actually
 * ran.
 *
 * The value is not a new measurement; it is the checklist in one place and a verdict that
 * distinguishes "clean" from "three checks could not run". Every section is optional and
 * carries its own error, because a missing sidecar or a map that was never compiled must not
 * turn the whole review into a stack trace.
 */
export const reviewMapTool = defineTool({
  name: "review_map",
  description:
    "Audits a map in one call: FGD lint, its own rules file, organisation, and -- when a " +
    "compiled .bsp sits beside it -- the budget report, lightmap and visleaf statistics and " +
    "the asset dependency walk. `deep: true` adds the room segmentation and the longest " +
    "sight lines. Every section reports whether it ran and why not, so 'clean' never hides " +
    "a check that was skipped. Read-only and offline; nothing launches the game.",
  realm: "map",
  inputSchema: {
    vmf: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    bsp: z
      .string()
      .optional()
      .describe("The compiled map. Defaults to the sibling .bsp when it exists."),
    rulesPath: z.string().optional().describe("Override the map's own .rules.json."),
    navDump: z.string().optional().describe("A `<map>_nav.txt` dump for the offline nav report."),
    deep: z
      .boolean()
      .default(false)
      .describe("Also run the room segmentation and the longest sight lines. Slower."),
    game: GAME,
    limit: z.number().int().min(1).max(500).default(50),
  },
  outputSchema: {
    vmf: z.string(),
    bsp: z.string().nullable(),
    verdict: z.enum(["clean", "warning", "error", "incomplete"]),
    counts: z.object({ errors: z.number(), warnings: z.number(), skipped: z.number() }),
    sections: z.object({
      lint: LINT.nullable(),
      rules: RULES.nullable(),
      organisation: ORGANISATION.nullable(),
      rooms: ROOMS.nullable(),
      sightlines: SIGHTLINES.nullable(),
      report: REPORT.nullable(),
      lightmap: LIGHTMAP.nullable(),
      visleaf: VISLEAF.nullable(),
      dependencies: DEPS.nullable(),
      nav: NAV.nullable(),
    }),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const vmf = resolveVmfInput(args.vmf, ctx.config);
    let bsp: string | null = args.bsp
      ? resolveInput(args.bsp, ctx.config)
      : join(dirname(vmf), `${basename(vmf, ".vmf")}.bsp`);
    if (!existsSync(bsp)) bsp = null;

    const sections: {
      lint: z.infer<typeof LINT> | null;
      rules: z.infer<typeof RULES> | null;
      organisation: z.infer<typeof ORGANISATION> | null;
      rooms: z.infer<typeof ROOMS> | null;
      sightlines: z.infer<typeof SIGHTLINES> | null;
      report: z.infer<typeof REPORT> | null;
      lightmap: z.infer<typeof LIGHTMAP> | null;
      visleaf: z.infer<typeof VISLEAF> | null;
      dependencies: z.infer<typeof DEPS> | null;
      nav: z.infer<typeof NAV> | null;
    } = {
      lint: null,
      rules: null,
      organisation: null,
      rooms: null,
      sightlines: null,
      report: null,
      lightmap: null,
      visleaf: null,
      dependencies: null,
      nav: null,
    };

    try {
      const r = (await readVmfLint.handler(
        { path: vmf, game: args.game, limit: args.limit } as never,
        ctx,
      )) as {
        total: number;
        bySeverity: Record<string, number>;
        byRule: Record<string, number>;
        findings: Array<{ rule: string; severity: string; message: string }>;
      };
      sections.lint = {
        ran: true,
        ok: true,
        error: null,
        total: r.total,
        errors: r.bySeverity["error"] ?? 0,
        warnings: r.bySeverity["warning"] ?? 0,
        byRule: r.byRule,
        top: r.findings.slice(0, 10).map((f) => ({
          rule: f.rule,
          severity: f.severity,
          message: f.message,
        })),
      };
    } catch (error) {
      sections.lint = {
        ran: false,
        ok: false,
        error: failure(error),
        total: 0,
        errors: 0,
        warnings: 0,
        byRule: {},
        top: [],
      };
    }

    try {
      const r = (await checkVmfRulesTool.handler(
        {
          path: vmf,
          ...(args.rulesPath !== undefined ? { rulesPath: args.rulesPath } : {}),
          severity: "all",
        } as never,
        ctx,
      )) as {
        overall: "pass" | "warn" | "fail" | "skipped";
        errorCount: number;
        warningCount: number;
        matchedNothing: string[];
      };
      sections.rules = {
        ran: true,
        ok: true,
        error: null,
        overall: r.overall,
        errors: r.errorCount,
        warnings: r.warningCount,
        matchedNothing: r.matchedNothing,
      };
    } catch (error) {
      sections.rules = {
        ran: false,
        ok: false,
        error: failure(error),
        overall: "skipped",
        errors: 0,
        warnings: 0,
        matchedNothing: [],
      };
    }

    try {
      const r = readMapOrganisationTool.handler({ path: vmf } as never, ctx) as {
        visgroups: unknown[];
        groups: unknown[];
        cordonsActive: boolean;
        solidsInNoVisgroup: number;
        solidsInNoGroup: number;
      };
      sections.organisation = {
        ran: true,
        ok: true,
        error: null,
        visgroups: r.visgroups.length,
        groups: r.groups.length,
        cordonsActive: r.cordonsActive,
        solidsInNoVisgroup: r.solidsInNoVisgroup,
        solidsInNoGroup: r.solidsInNoGroup,
      };
    } catch (error) {
      sections.organisation = {
        ran: false,
        ok: false,
        error: failure(error),
        visgroups: 0,
        groups: 0,
        cordonsActive: false,
        solidsInNoVisgroup: 0,
        solidsInNoGroup: 0,
      };
    }

    if (args.deep) {
      try {
        const r = readVmfRoomsTool.handler(
          { path: vmf, step: 16, maxCells: 1_000_000, minRoomArea: 4096, mergeLimit: 20 } as never,
          ctx,
        ) as {
          sealed: boolean;
          roomCount: number;
          unreachable: unknown[];
        };
        sections.rooms = {
          ran: true,
          ok: true,
          error: null,
          sealed: r.sealed,
          roomCount: r.roomCount,
          unreachable: r.unreachable.length,
        };
      } catch (error) {
        sections.rooms = {
          ran: false,
          ok: false,
          error: failure(error),
          sealed: false,
          roomCount: 0,
          unreachable: 0,
        };
      }

      try {
        const r = readVmfSightlinesTool.handler(
          { path: vmf, step: 16, eyeHeight: 64, spacing: 8, maxCells: 1_000_000, limit: 5 } as never,
          ctx,
        ) as { pairsTested: number; longest: Array<{ units: number }> };
        sections.sightlines = {
          ran: true,
          ok: true,
          error: null,
          pairsTested: r.pairsTested,
          longestUnits: r.longest[0]?.units ?? null,
        };
      } catch (error) {
        sections.sightlines = {
          ran: false,
          ok: false,
          error: failure(error),
          pairsTested: 0,
          longestUnits: null,
        };
      }
    }

    if (bsp) {
      try {
        const r = readMapReportTool.handler({ path: bsp } as never, ctx) as {
          overall: "pass" | "warn" | "fail" | "skipped";
          summary: { pass: number; warn: number; fail: number; skipped: number };
        };
        sections.report = {
          ran: true,
          ok: true,
          error: null,
          overall: r.overall,
          pass: r.summary.pass,
          warn: r.summary.warn,
          fail: r.summary.fail,
          skipped: r.summary.skipped,
        };
      } catch (error) {
        sections.report = {
          ran: false,
          ok: false,
          error: failure(error),
          overall: "skipped",
          pass: 0,
          warn: 0,
          fail: 0,
          skipped: 0,
        };
      }

      try {
        const r = readLightmapBudgetTool.handler({ path: bsp, limit: 10 } as never, ctx) as {
          totalLuxels: number;
          facesWithLightmap: number;
        };
        sections.lightmap = {
          ran: true,
          ok: true,
          error: null,
          totalLuxels: r.totalLuxels,
          facesWithLightmap: r.facesWithLightmap,
        };
      } catch (error) {
        sections.lightmap = {
          ran: false,
          ok: false,
          error: failure(error),
          totalLuxels: 0,
          facesWithLightmap: 0,
        };
      }

      try {
        const r = readVisleafStatsTool.handler({ path: bsp } as never, ctx) as {
          leafCount: number;
          clusterCount: number | null;
        };
        sections.visleaf = {
          ran: true,
          ok: true,
          error: null,
          leafCount: r.leafCount,
          clusterCount: r.clusterCount,
        };
      } catch (error) {
        sections.visleaf = {
          ran: false,
          ok: false,
          error: failure(error),
          leafCount: 0,
          clusterCount: null,
        };
      }

      try {
        const r = (await readMapDependenciesTool.handler(
          { path: bsp, game: args.game, limit: 200 } as never,
          ctx,
        )) as { missingCount: number; looseCount: number; packedUnreferencedCount: number };
        sections.dependencies = {
          ran: true,
          ok: true,
          error: null,
          missing: r.missingCount,
          loose: r.looseCount,
          packedUnreferenced: r.packedUnreferencedCount,
        };
      } catch (error) {
        sections.dependencies = {
          ran: false,
          ok: false,
          error: failure(error),
          missing: 0,
          loose: 0,
          packedUnreferenced: 0,
        };
      }
    }

    if (args.navDump) {
      try {
        const r = (await navTroubleReport.handler(
          { dump: args.navDump, expected: "either" } as never,
          ctx,
        )) as { verdict: "pass" | "fail" | "warn" | "unknown"; failures: unknown[] };
        sections.nav = {
          ran: true,
          ok: true,
          error: null,
          verdict: r.verdict,
          failures: r.failures.length,
        };
      } catch (error) {
        sections.nav = {
          ran: false,
          ok: false,
          error: failure(error),
          verdict: "unknown",
          failures: 0,
        };
      }
    }

    const errors =
      (sections.lint?.errors ?? 0) +
      (sections.rules?.errors ?? 0) +
      (sections.report?.fail ?? 0) +
      (sections.dependencies?.missing ?? 0) +
      (sections.nav?.verdict === "fail" ? 1 : 0);
    const warnings =
      (sections.lint?.warnings ?? 0) +
      (sections.rules?.warnings ?? 0) +
      (sections.report?.warn ?? 0);
    const skipped = Object.values(sections).filter((section) => section !== null && !section.ran).length;
    const requiredMissing = sections.lint === null || !sections.lint.ran || (bsp !== null && !(sections.report?.ran ?? false));
    const verdict =
      requiredMissing ? "incomplete" : errors > 0 ? "error" : warnings > 0 ? "warning" : "clean";

    return {
      vmf,
      bsp,
      verdict: verdict as "clean" | "warning" | "error" | "incomplete",
      counts: { errors, warnings, skipped },
      sections,
      nextStep:
        verdict === "incomplete"
          ? "A required check did not run; read its section's error. Lint needs the sidecar " +
            "and the game install; the budget report needs a compiled .bsp."
          : verdict === "error"
            ? "Fix the errors first, then run this again. read_vmf_lint names the rule, " +
              "read_map_dependencies the missing asset, read_leak the leak."
            : verdict === "warning"
              ? "No errors. The warnings are design decisions or budget pressure; " +
                "read_map_report says which criterion each one is."
              : "Clean on every check that ran. Compile and look: the eye is the last oracle.",
    };
  },
});

export const reviewTools = [reviewMapTool];
