import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { readEntityLump } from "../bsp/entities.js";
import { parseNavDump } from "../bsp/navdump.js";
import type { FinaleEntity, FinaleRegion } from "../campaign/finale.js";
import { checkFinale } from "../campaign/finale.js";
import { defineTool } from "../mcp/registry.js";
import type { ToolContext } from "../mcp/registry.js";
import { callSidecar } from "../sidecar/client.js";
import { resolveInput } from "./paths.js";

const VEC3 = z.array(z.number()).length(3);

interface SidecarEntity {
  classname: string;
  targetname: string | null;
  origin: number[] | null;
  solidCount: number;
  solidBounds?: Array<{ lo: number[]; hi: number[] }>;
  keyvalues: Record<string, string>;
  outputs: Array<{
    output: string;
    target: string;
    input: string;
    params: string;
    delay: string;
    times: string;
  }>;
}

const SCRIPT_DIR = "scripts/vscripts";

/**
 * Reads the custom-finale script from the first place that has it.
 *
 * `undefined` means the caller gave no place to look, which is different from `null`:
 * "not checked" is a warning, "looked and absent" is the error that stops a finale.
 */
async function readFinaleScript(
  name: string,
  dirs: readonly string[],
  vpk: string | undefined,
  ctx: ToolContext,
): Promise<{ text: string | null | undefined; resolvedName: string }> {
  const file = `${name}.nut`;
  for (const base of dirs) {
    for (const candidate of [
      join(base, file),
      join(base, SCRIPT_DIR, file),
      join(base, "vscripts", file),
    ]) {
      if (existsSync(candidate)) {
        return { text: readFileSync(candidate, "utf8"), resolvedName: file };
      }
    }
  }
  if (vpk !== undefined) {
    try {
      const reply = await callSidecar<{ text: string }>(
        "vpk_read",
        { path: vpk, entry: `${SCRIPT_DIR}/${file}` },
        ctx.config,
        120_000,
      );
      return { text: reply.text, resolvedName: file };
    } catch {
      return { text: null, resolvedName: file };
    }
  }
  if (dirs.length === 0) return { text: undefined, resolvedName: file };
  return { text: null, resolvedName: file };
}

export const checkFinaleTool = defineTool({
  name: "check_finale",
  description:
    "Checks a finale as a contract, not as a trigger that exists. Reads the entities of a " +
    ".vmf or a compiled .bsp and reports: the finale type and whether it is one the game " +
    "ships; a custom finale's script, its DirectorOptions and whether the stage count has " +
    "the stages behind it; a gauntlet's `info_target nav_flow_target`; the outtro stats " +
    "entity; the disabled arrival changelevel a finale map needs; whether the trigger " +
    "stands over a FINALE nav area (from the region brush in a VMF, or from a nav dump); " +
    "whether anything is wired to `FinaleEscapeStarted`; and a trigger that starts disabled " +
    "with nothing to enable it. Pass `scriptsDirs` or a campaign `vpk` for the script check; " +
    "without one it says so rather than assuming. Use it before a play test, and again on " +
    "the shipping BSP.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("The .vmf or .bsp, absolute or relative to the repo root."),
    navDump: z
      .string()
      .optional()
      .describe("Optional `<map>_nav.txt`; supplies FINALE/CHECKPOINT areas and the escape route."),
    scriptsDirs: z
      .array(z.string())
      .default([])
      .describe(
        "Directories to search for `<name>.nut`: a `scripts/vscripts` directory, a campaign " +
          "staging root, or a `scripts` directory.",
      ),
    script: z
      .string()
      .optional()
      .describe("Explicit path to the finale script, overriding the name lookup."),
    vpk: z.string().optional().describe("Campaign VPK to read scripts/vscripts from."),
    expectFinale: z
      .boolean()
      .default(true)
      .describe(
        "Whether this chapter is the campaign's last. False reports a trigger but does not " +
          "demand one.",
      ),
  },
  outputSchema: {
    path: z.string(),
    map: z.string(),
    source: z.enum(["vmf", "bsp"]),
    findings: z.array(
      z.object({
        severity: z.enum(["error", "warning", "info"]),
        rule: z.string(),
        message: z.string(),
        entity: z.string().optional(),
      }),
    ),
    counts: z.object({ error: z.number(), warning: z.number(), info: z.number() }),
    ok: z.boolean(),
    type: z.number().nullable(),
    scriptName: z.string().nullable(),
    triggerCount: z.number(),
    finaleNavAreas: z.number(),
    overFinaleNav: z.boolean().nullable(),
    stageCount: z.number().nullable(),
    definedStages: z.number(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const kind = extname(path).toLowerCase();
    if (kind !== ".vmf" && kind !== ".bsp") throw new Error(`${path} is not a .vmf or .bsp`);
    const map = basename(path, extname(path));

    let entities: FinaleEntity[];
    let finaleRegions: FinaleRegion[] = [];
    if (kind === ".vmf") {
      const reply = await callSidecar<{ entities: SidecarEntity[] }>(
        "vmf_read",
        { path, limit: 20_000 },
        ctx.config,
        300_000,
      );
      entities = reply.entities.map((e) => ({
        classname: e.classname,
        ...(e.targetname ? { targetname: e.targetname } : {}),
        ...(e.origin ? { origin: [e.origin[0]!, e.origin[1]!, e.origin[2]!] as [number, number, number] } : {}),
        keyvalues: Object.entries(e.keyvalues),
        connections: e.outputs.map((o) => [
          o.output,
          `${o.target},${o.input},${o.params},${o.delay},${o.times}`,
        ]),
        solidCount: e.solidCount,
      }));
      for (const raw of reply.entities) {
        if (raw.classname !== "func_nav_attribute_region") continue;
        const flags = Number.parseInt(raw.keyvalues["spawnflags"] ?? "0", 10);
        if ((flags & 0x40) === 0) continue;
        for (const b of raw.solidBounds ?? []) {
          finaleRegions.push({
            lo: [b.lo[0]!, b.lo[1]!, b.lo[2]!],
            hi: [b.hi[0]!, b.hi[1]!, b.hi[2]!],
          });
        }
      }
    } else {
      entities = readEntityLump(path).entities.map((e) => ({
        classname: e.classname,
        ...(e.targetname ? { targetname: e.targetname } : {}),
        ...(e.origin ? { origin: e.origin } : {}),
        keyvalues: e.keyvalues,
        connections: e.connections,
        solidCount: e.solidCount,
      }));
    }

    let navAreas: Array<{ center: [number, number, number]; attributes: string[] }> | undefined;
    if (args.navDump) {
      const dumpPath = resolveInput(args.navDump, ctx.config);
      const dump = parseNavDump(dumpPath, readFileSync(dumpPath, "utf8"));
      navAreas = dump.areas.map((a) => ({ center: a.center, attributes: a.attributes }));
    }

    // The script name follows the trigger, so ask the entity first and only then look.
    const trigger = entities.find((e) => e.classname === "trigger_finale");
    const defaultValue = `${map}_finale`;
    const rawScript = trigger?.keyvalues.find(([k]) => k.toLowerCase() === "scriptfile")?.[1] ?? "";
    const scriptBase =
      rawScript.trim() === ""
        ? defaultValue
        : rawScript
            .trim()
            .replace(/\\/g, "/")
            .replace(/^scripts\/vscripts\//, "")
            .replace(/\.nut$/i, "");
    const scriptDirs = (args.scriptsDirs ?? []).map((p) => resolveInput(p, ctx.config));
    const vpk = args.vpk ? resolveInput(args.vpk, ctx.config) : undefined;
    let scriptText: string | null | undefined;
    let resolvedName = `${scriptBase}.nut`;
    if (args.script) {
      const scriptPath = resolveInput(args.script, ctx.config);
      scriptText = readFileSync(scriptPath, "utf8");
      resolvedName = basename(scriptPath);
    } else {
      const found = await readFinaleScript(scriptBase, scriptDirs, vpk, ctx);
      scriptText = found.text;
      resolvedName = found.resolvedName;
    }

    const report = checkFinale({
      map,
      entities,
      ...(finaleRegions.length > 0 ? { finaleRegions } : {}),
      ...(navAreas ? { navAreas } : {}),
      scriptText,
      scriptName: resolvedName,
      expectFinale: args.expectFinale,
    });
    const counts = {
      error: report.findings.filter((f) => f.severity === "error").length,
      warning: report.findings.filter((f) => f.severity === "warning").length,
      info: report.findings.filter((f) => f.severity === "info").length,
    };

    return {
      path,
      map,
      source: kind === ".vmf" ? ("vmf" as const) : ("bsp" as const),
      findings: report.findings,
      counts,
      ok: report.ok,
      type: report.type,
      scriptName: report.scriptName,
      triggerCount: report.triggerCount,
      finaleNavAreas: report.finaleNavAreas,
      overFinaleNav: report.overFinaleNav,
      stageCount: report.stageCount,
      definedStages: report.definedStages,
    };
  },
});

export const finaleTools = [checkFinaleTool];
