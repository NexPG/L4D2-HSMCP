import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { checkNavFreshness } from "../bsp/nav.js";
import { defineTool } from "../mcp/registry.js";
import { checkCampaignTool } from "./campaign.js";
import { runCompile } from "./compile.js";
import { checkFinaleTool } from "./finale.js";
import { readStaticProps } from "./measure.js";
import { navTroubleReport } from "./navtrouble.js";
import { resolveInput } from "./paths.js";
import { runMapTest, runNavGenerate } from "./runtime.js";
import { readVmfLint } from "./vmf.js";

const KIND = z.enum(["first", "middle", "last", "single"]);
const STAGE = z.enum(["campaign", "lint", "compile", "nav", "props", "finale", "trouble", "test"]);

const MAP = z.object({
  name: z
    .string()
    .optional()
    .describe("Map name without a path or .bsp. Derived from the source when omitted."),
  vmf: z.string().optional().describe("Source .vmf; enables lint and compile."),
  bsp: z
    .string()
    .optional()
    .describe("Existing compiled .bsp, used when compile is skipped or as a fallback."),
  nav: z
    .string()
    .optional()
    .describe(
      "Existing .nav matching `bsp`, for a gate run that does not regenerate nav. The test " +
        "and trouble stages use it exactly as given.",
    ),
  kind: KIND.default("middle").describe(
    "Chapter role: first/middle need a checkpoint goal, last needs a finale, single may have either.",
  ),
  waitFor: z
    .string()
    .optional()
    .describe(
      "Regex the map test waits for. Default `Loading: [0-9]`; for a finale test use the " +
        "echo the map's `FinaleStart` output emits, with `commands` forcing the start.",
    ),
  commands: z
    .array(z.string())
    .default([])
    .describe(
      "Console commands to run after the map loads. `ent_fire <trigger> ForceFinaleStart` " +
        "turns the load test into a finale start test without a player walking there.",
    ),
  scriptsDir: z
    .string()
    .optional()
    .describe(
      "scripts/vscripts directory installed for the test. Default `<source>/../addon/scripts/vscripts` " +
        "when it exists.",
    ),
});

const LINT = z.object({
  ok: z.boolean(),
  errors: z.number(),
  warnings: z.number(),
  total: z.number(),
});

const COMPILE = z.object({
  ok: z.boolean(),
  bsp: z.string().nullable(),
  bspBytes: z.number().nullable(),
  leaked: z.boolean(),
  toolchain: z.string(),
  failedStage: z.string().nullable(),
});

const NAV = z.object({
  ok: z.boolean(),
  bsp: z.string().nullable(),
  nav: z.string().nullable(),
  dump: z.string().nullable(),
  fresh: z.boolean(),
  stringtableDictionary: z.boolean(),
  areas: z.number().nullable(),
  verdict: z.string().nullable(),
  generator: z.string(),
});

const PROPS = z.object({
  read: z.boolean(),
  ok: z.boolean(),
  missingPhysicsCount: z.number(),
  missingPhysics: z.array(z.object({ model: z.string(), instances: z.number() })),
});

const FINALE = z.object({
  ok: z.boolean(),
  type: z.number().nullable(),
  scriptName: z.string().nullable(),
  errors: z.number(),
  warnings: z.number(),
  rules: z.array(z.string()),
});

const TROUBLE = z.object({
  ok: z.boolean(),
  verdict: z.string(),
  failures: z.array(z.object({ name: z.string(), areas: z.number().nullable() })),
  selectedAreas: z.number().nullable(),
  selectedPoints: z.array(z.array(z.number()).length(3)),
});

const TEST = z.object({
  ok: z.boolean(),
  matched: z.boolean(),
  reason: z.string(),
  screenshotPath: z.string().nullable(),
  navErrors: z.array(z.string()),
});

const MAP_RESULT = z.object({
  map: z.string(),
  kind: KIND,
  ok: z.boolean(),
  stoppedAt: z.string().nullable(),
  source: z.string().nullable(),
  shippingBsp: z.string().nullable(),
  shippingNav: z.string().nullable(),
  lint: LINT.nullable(),
  compile: COMPILE.nullable(),
  nav: NAV.nullable(),
  props: PROPS.nullable(),
  finale: FINALE.nullable(),
  trouble: TROUBLE.nullable(),
  test: TEST.nullable(),
});

const CAMPAIGN = z.object({
  ok: z.boolean(),
  overall: z.string(),
  errors: z.number(),
  warnings: z.number(),
  findings: z.array(z.object({ severity: z.string(), rule: z.string(), message: z.string() })),
});

export const runCampaignGate = defineTool({
  name: "run_campaign_gate",
  description:
    "Runs a campaign through one gate instead of a checklist an agent can forget: mission " +
    "check, VMF lint, compile, nav generation with the string-table dictionary baked, a " +
    "fresh BSP/nav pair, static-prop collision, the finale contract, the engine's own " +
    "`nav_trouble_report`, and a map test that installs the exact pair it just produced. " +
    "Every stage reports its own verdict and the gate stops at the first hard failure by " +
    "default, because a compile after a lint error or a nav for a map that did not compile " +
    "is wasted time. `stopOnError: false` runs every stage and collects the whole picture. " +
    "The shipping BSP is the nav-generated one, not the compile output: the engine appends " +
    "the dictionary at nav time, and shipping the compile output makes the pair stale. " +
    "Long-running and guarded; the full gate on two maps is tens of minutes.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    mission: z
      .string()
      .optional()
      .describe("Mission .txt for the campaign check and the add-on identity."),
    vpk: z
      .string()
      .optional()
      .describe("Campaign VPK: used for the mission check and for reading scripts from it."),
    missionEntry: z
      .string()
      .optional()
      .describe("Entry inside `vpk`, e.g. missions/campaign.txt, when the mission is packed."),
    maps: z.array(MAP).min(1),
    stages: z
      .array(STAGE)
      .default(["campaign", "lint", "compile", "nav", "props", "finale", "trouble", "test"])
      .describe("Stages to run, in this order. Default: all of them."),
    navDir: z
      .string()
      .optional()
      .describe(
        "Where nav generation writes its BSP/nav/dump. Default `<source dir>/nav`; the " +
          "campaign layout is `<campaign>/src` -> `<campaign>/nav`.",
      ),
    mapsDirs: z.array(z.string()).optional().describe("For the campaign check; defaults from the mission."),
    materialsDirs: z.array(z.string()).optional().describe("For the campaign check; defaults from the mission."),
    scriptsDirs: z
      .array(z.string())
      .optional()
      .describe("For the finale check. Default `<campaign>/addon` and `<campaign>` beside the source."),
    fast: z.boolean().default(true).describe("Passed to run_compile: `-fast` vvis/vrad."),
    hdr: z.boolean().default(true).describe("Passed to run_compile: `-both` lightmaps."),
    navSlopeLimit: z.number().min(0.1).max(1).optional(),
    timeoutMinutes: z.number().int().min(1).max(600).default(60),
    navTimeoutSeconds: z.number().int().min(30).max(900).default(240),
    troubleTimeoutSeconds: z.number().int().min(20).max(300).default(90),
    testTimeoutSeconds: z.number().int().min(10).max(600).default(180),
    screenshot: z.boolean().default(true),
    stopOnError: z.boolean().default(true),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    ok: z.boolean(),
    stopped: z.boolean(),
    stagesRun: z.array(STAGE),
    campaign: CAMPAIGN.nullable(),
    maps: z.array(MAP_RESULT),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const stages = args.stages ?? [
      "campaign",
      "lint",
      "compile",
      "nav",
      "props",
      "finale",
      "trouble",
      "test",
    ];
    const stagesRun: z.infer<typeof STAGE>[] = [];
    let stopped = false;

    let campaign: z.infer<typeof CAMPAIGN> | null = null;
    if (stages.includes("campaign")) {
      if (args.mission || (args.vpk && args.missionEntry)) {
        stagesRun.push("campaign");
        const missionPath = args.mission ? resolveInput(args.mission, ctx.config) : undefined;
        const base = missionPath ? dirname(missionPath) : undefined;
        const mapsDirs =
          args.mapsDirs ??
          (base ? [join(base, "..", "maps")] : undefined);
        const materialsDirs =
          args.materialsDirs ??
          (base ? [join(base, "..", "materials")] : undefined);
        const vpk = args.vpk ? resolveInput(args.vpk, ctx.config) : undefined;
        const result = (await checkCampaignTool.handler(
          {
            // A mission on disk and a mission inside a VPK are two different sources;
            // check_campaign refuses both at once. The VPK still counts as an entry
            // provider through `vpks`.
            ...(missionPath
              ? { path: missionPath }
              : { vpk: vpk!, entry: args.missionEntry! }),
            ...(mapsDirs ? { mapsDirs: mapsDirs.map((p) => resolveInput(p, ctx.config)) } : {}),
            ...(materialsDirs
              ? { materialsDirs: materialsDirs.map((p) => resolveInput(p, ctx.config)) }
              : {}),
            ...(vpk ? { vpks: [vpk] } : {}),
          },
          ctx,
        )) as {
          overall: string;
          findings: Array<{ severity: string; rule: string; message: string }>;
        };
        const errors = result.findings.filter((f) => f.severity === "error").length;
        const warnings = result.findings.filter((f) => f.severity === "warning").length;
        campaign = {
          ok: result.overall !== "fail",
          overall: result.overall,
          errors,
          warnings,
          findings: result.findings.slice(0, 50),
        };
        if (!campaign.ok && args.stopOnError) {
          stopped = true;
        }
      }
    }

    const results: Array<z.infer<typeof MAP_RESULT>> = [];

    for (const spec of args.maps) {
      if (stopped) break;
      const source = spec.vmf
        ? resolveInput(spec.vmf, ctx.config)
        : spec.bsp
          ? resolveInput(spec.bsp, ctx.config)
          : null;
      if (!source) {
        throw new Error(`map ${spec.name ?? "(unnamed)"}: give a vmf or a bsp`);
      }
      if (!existsSync(source)) throw new Error(`${source} does not exist`);
      const map = spec.name ?? basename(source, extname(source));
      const expected: "finale" | "either" | "checkpoint" =
        spec.kind === "last" ? "finale" : spec.kind === "single" ? "either" : "checkpoint";
      const navDir = args.navDir
        ? resolveInput(args.navDir, ctx.config)
        : join(dirname(source), "nav");

      const result: z.infer<typeof MAP_RESULT> = {
        map,
        kind: spec.kind,
        ok: true,
        stoppedAt: null,
        source,
        shippingBsp: spec.bsp ? resolveInput(spec.bsp, ctx.config) : null,
        shippingNav: spec.nav ? resolveInput(spec.nav, ctx.config) : null,
        lint: null,
        compile: null,
        nav: null,
        props: null,
        finale: null,
        trouble: null,
        test: null,
      };

      const hardStop = (stage: string): void => {
        result.ok = false;
        result.stoppedAt = stage;
        if (args.stopOnError) stopped = true;
      };

      if (stages.includes("lint") && spec.vmf) {
        stagesRun.push("lint");
        const lint = (await readVmfLint.handler(
          { path: source, collapseInstances: false, limit: 2000 },
          ctx,
        )) as {
          bySeverity: Record<string, number>;
          total: number;
          findings: Array<{ severity: string; rule: string }>;
        };
        const errors = lint.bySeverity["error"] ?? 0;
        const warnings = lint.bySeverity["warning"] ?? 0;
        result.lint = { ok: errors === 0, errors, warnings, total: lint.total };
        if (errors > 0) {
          hardStop("lint");
          results.push(result);
          continue;
        }
      }

      let compiledBsp: string | null = spec.bsp ? resolveInput(spec.bsp, ctx.config) : null;
      if (stages.includes("compile")) {
        if (!spec.vmf) {
          throw new Error(`map ${map}: the compile stage needs a vmf`);
        }
        stagesRun.push("compile");
        const compile = (await runCompile.handler(
          {
            vmf: source,
            fast: args.fast,
            hdr: args.hdr,
            stages: ["vbsp", "vvis", "vrad"],
            toolchain: "plusplus",
            timeoutMinutes: args.timeoutMinutes,
            confirm: true,
          },
          ctx,
        )) as {
          ok: boolean;
          bsp: string;
          bspExists: boolean;
          bspBytes: number | null;
          leaked: boolean;
          toolchain: string;
          stages: Array<{ stage: string; clean: boolean; timedOut: boolean }>;
        };
        const failed = compile.stages.find((s) => !s.clean || s.timedOut);
        result.compile = {
          ok: compile.ok,
          bsp: compile.bspExists ? compile.bsp : null,
          bspBytes: compile.bspBytes,
          leaked: compile.leaked,
          toolchain: compile.toolchain,
          failedStage: failed?.stage ?? null,
        };
        compiledBsp = compile.bspExists ? compile.bsp : null;
        if (!compile.ok) {
          hardStop("compile");
          results.push(result);
          continue;
        }
      }

      if (stages.includes("nav")) {
        const from = compiledBsp ?? result.shippingBsp;
        if (!from) {
          throw new Error(`map ${map}: the nav stage needs a compiled bsp`);
        }
        stagesRun.push("nav");
        const nav = (await runNavGenerate.handler(
          {
            maps: [from],
            addonsToHide: [],
            outDir: navDir,
            timeoutSeconds: args.navTimeoutSeconds,
            ...(args.navSlopeLimit !== undefined ? { navSlopeLimit: args.navSlopeLimit } : {}),
            confirm: true,
          },
          ctx,
        )) as {
          maps: Array<{
            generated: boolean;
            bsp: string | null;
            nav: string | null;
            dump: string | null;
            fresh: boolean;
            stringtableDictionary: boolean;
            areas: number | null;
            verdict: string | null;
          }>;
        };
        const one = nav.maps[0];
        if (!one) throw new Error(`map ${map}: nav generation returned nothing`);
        result.nav = {
          ok: one.generated && one.fresh && one.stringtableDictionary,
          bsp: one.bsp,
          nav: one.nav,
          dump: one.dump,
          fresh: one.fresh,
          stringtableDictionary: one.stringtableDictionary,
          areas: one.areas,
          verdict: one.verdict,
          generator: "run_nav_generate",
        };
        result.shippingBsp = one.bsp;
        result.shippingNav = one.nav;
        if (!result.nav.ok) {
          hardStop("nav");
          results.push(result);
          continue;
        }
      }

      if (result.shippingBsp && result.shippingNav) {
        const fresh = checkNavFreshness(result.shippingNav, result.shippingBsp);
        if (fresh.verdict !== "fresh") {
          // A pair that passed nav generation but not the read-back is a contradiction,
          // not a warning: something changed one file after the generator ran.
          result.ok = false;
          result.stoppedAt ??= "nav";
          if (args.stopOnError) stopped = true;
        }
      }

      if (stages.includes("props") && result.shippingBsp) {
        stagesRun.push("props");
        const props = (await readStaticProps.handler(
          {
            path: result.shippingBsp,
            ...(spec.vmf ? { vmf: source } : {}),
            limit: 2000,
          },
          ctx,
        )) as {
          read?: boolean;
          missingPhysicsCount?: number;
          missingPhysicsSolidCount?: number;
          missingPhysics?: Array<{ model: string; instances: number; decorative?: boolean }>;
        };
        const missing = props.missingPhysics ?? [];
        const solidMissing = missing.filter((m) => m.decorative !== true);
        result.props = {
          read: props.read === true,
          ok: (props.missingPhysicsSolidCount ?? solidMissing.length) === 0,
          missingPhysicsCount: props.missingPhysicsCount ?? missing.length,
          missingPhysics: solidMissing.map((m) => ({ model: m.model, instances: m.instances })),
        };
      }

      if (stages.includes("finale")) {
        stagesRun.push("finale");
        const defaultScriptDirs = [
          join(dirname(source), "..", "addon"),
          join(dirname(source), ".."),
        ];
        const scriptsDirs = (args.scriptsDirs ?? defaultScriptDirs).map((p) =>
          resolveInput(p, ctx.config),
        );
        const dumpPath = result.nav?.dump ?? join(navDir, `${map}_nav.txt`);
        const finale = (await checkFinaleTool.handler(
          {
            path: spec.vmf ?? (result.shippingBsp ?? source),
            ...(existsSync(dumpPath) ? { navDump: dumpPath } : {}),
            scriptsDirs,
            ...(args.vpk ? { vpk: resolveInput(args.vpk, ctx.config) } : {}),
            expectFinale: spec.kind === "last" || spec.kind === "single",
          },
          ctx,
        )) as {
          ok: boolean;
          type: number | null;
          scriptName: string | null;
          counts: { error: number; warning: number };
          findings: Array<{ rule: string }>;
        };
        result.finale = {
          ok: finale.ok,
          type: finale.type,
          scriptName: finale.scriptName,
          errors: finale.counts.error,
          warnings: finale.counts.warning,
          rules: finale.findings.map((f) => f.rule),
        };
        if (!finale.ok) {
          hardStop("finale");
          results.push(result);
          continue;
        }
      }

      if (stages.includes("trouble")) {
        const bsp = result.shippingBsp;
        if (!bsp) {
          throw new Error(`map ${map}: the trouble stage needs a bsp`);
        }
        stagesRun.push("trouble");
        const trouble = (await navTroubleReport.handler(
          {
            map,
            bsp,
            ...(result.shippingNav ? { nav: result.shippingNav } : {}),
            expected,
            addonsToHide: [],
            timeoutSeconds: args.troubleTimeoutSeconds,
            confirm: true,
          },
          ctx,
        )) as {
          verdict: string;
          failures: Array<{ name: string; areas: number | null }>;
          selectedAreas: number | null;
          selectedPoints: Array<[number, number, number]>;
          checks: Array<{ name: string }>;
        };
        result.trouble = {
          ok: trouble.verdict === "pass",
          verdict: trouble.verdict,
          failures: trouble.failures.map((f) => ({ name: f.name, areas: f.areas })),
          selectedAreas: trouble.selectedAreas,
          selectedPoints: trouble.selectedPoints,
        };
        if (!result.trouble.ok) {
          hardStop("trouble");
          results.push(result);
          continue;
        }
      }

      if (stages.includes("test")) {
        const bsp = result.shippingBsp;
        if (!bsp) {
          throw new Error(`map ${map}: the test stage needs a bsp`);
        }
        stagesRun.push("test");
        const defaultScripts = join(dirname(source), "..", "addon", "scripts", "vscripts");
        const scriptsDir = spec.scriptsDir
          ? resolveInput(spec.scriptsDir, ctx.config)
          : existsSync(defaultScripts)
            ? defaultScripts
            : undefined;
        const test = (await runMapTest.handler(
          {
            map,
            bsp,
            ...(result.shippingNav ? { nav: result.shippingNav } : {}),
            ...(scriptsDir ? { scriptsDir } : {}),
            waitFor: spec.waitFor ?? "Loading: [0-9]",
            timeoutSeconds: args.testTimeoutSeconds,
            extraArgs: [],
            addonsToHide: [],
            commands: spec.commands ?? [],
            screenshot: args.screenshot,
            confirm: true,
          },
          ctx,
        )) as {
          matched: boolean;
          reason: string;
          screenshotPath: string | null;
          logTail: string[];
          _image?: { data: string; mimeType: string };
        };
        const navErrors = test.logTail.filter((line) =>
          /NAV ERRORS|Map is unplayable|missing stringtable dictionary/i.test(line),
        );
        result.test = {
          ok: test.matched && navErrors.length === 0,
          matched: test.matched,
          reason: test.reason,
          screenshotPath: test.screenshotPath,
          navErrors,
        };
        if (!result.test.ok) {
          hardStop("test");
        }
      }

      results.push(result);
    }

    const ok =
      (campaign?.ok ?? true) &&
      !stopped &&
      results.length === args.maps.length &&
      results.every((r) => r.ok);
    return {
      ok,
      stopped,
      stagesRun: [...new Set(stagesRun)],
      campaign,
      maps: results,
      note:
        "The shipping BSP is the nav-generated one: the engine appends the string-table " +
        "dictionary at nav time, so the compile output and the tested map are not the same " +
        "file. `stoppedAt` names the first hard failure for each map; the remaining stages " +
        "for that map are reported as null, not as passes.",
    };
  },
});

export const gateTools = [runCampaignGate];
