/**
 * Particle validation: the systems in a `.pcf`, the child names they point at and the
 * materials they draw. `read_particle` exposes the facts; this turns a missing material or a
 * broken child reference into a finding before the effect is placed.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readParticleTool } from "./particles.js";

const FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
});

export const checkParticleTool = defineTool({
  name: "check_particle",
  description:
    "Checks a loose `.pcf`: systems read, child references resolve to systems in the same " +
    "file, and every renderer material exists as a `.vmt` under one of `materialsDirs` when " +
    "given. It does not render; a system that loads but draws nothing is a different test.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("A loose .pcf, absolute or relative to the repo root."),
    materialsDirs: z
      .array(z.string())
      .default([])
      .describe("Material roots, e.g. `<addon>/materials`."),
  },
  outputSchema: {
    path: z.string(),
    overall: z.enum(["pass", "warn", "fail"]),
    findings: z.array(FINDING),
    counts: z.object({ error: z.number(), warning: z.number(), info: z.number() }),
    systems: z.number(),
    systemsWithChildren: z.number(),
    materials: z.array(z.object({ material: z.string(), found: z.boolean().nullable() })),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const result = (await readParticleTool.handler(
      { path, includeOperators: false } as never,
      ctx as never,
    )) as {
      read?: boolean;
      readError?: string;
      systems?: Array<{ name: string; materials?: string[]; children?: string[] }>;
    };
    const findings: Array<z.infer<typeof FINDING>> = [];
    if (!result.read) {
      findings.push({
        severity: "error",
        rule: "pcf-read",
        message: result.readError ?? "the PCF did not read",
      });
    }
    const systems = result.systems ?? [];
    const names = new Set(systems.map((system) => system.name));
    let systemsWithChildren = 0;
    const materialNames = new Set<string>();
    for (const system of systems) {
      if ((system.children?.length ?? 0) > 0) systemsWithChildren += 1;
      for (const child of system.children ?? []) {
        if (!names.has(child)) {
          findings.push({
            severity: "warning",
            rule: "pcf-child-missing",
            message: `${system.name} points at child ${child}, which is not a system in this file`,
          });
        }
      }
      for (const material of system.materials ?? []) materialNames.add(material);
    }
    const roots = (args.materialsDirs ?? []).map((dir) => resolveInput(dir, ctx.config));
    const materials = [...materialNames].map((material) => {
      let found: boolean | null = null;
      if (roots.length > 0) {
        const clean = material.replace(/\\/g, "/").replace(/^materials\//, "").replace(/\.vmt$/i, "");
        found = roots.some((root) => existsSync(join(root, `${clean}.vmt`)) || existsSync(join(root, `${clean}.vtf`)));
        if (!found) {
          findings.push({
            severity: "warning",
            rule: "pcf-material-missing",
            message: `${material} was not found under the material roots`,
          });
        }
      }
      return { material, found };
    });
    if (systems.length === 0) {
      findings.push({ severity: "warning", rule: "pcf-empty", message: "the PCF has no systems" });
    }
    const counts = {
      error: findings.filter((finding) => finding.severity === "error").length,
      warning: findings.filter((finding) => finding.severity === "warning").length,
      info: findings.filter((finding) => finding.severity === "info").length,
    };
    return {
      path,
      overall: counts.error > 0 ? ("fail" as const) : counts.warning > 0 ? ("warn" as const) : ("pass" as const),
      findings,
      counts,
      systems: systems.length,
      systemsWithChildren,
      materials,
    };
  },
});

export const particleCheckTools = [checkParticleTool];
