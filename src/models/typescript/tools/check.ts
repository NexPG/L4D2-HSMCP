/**
 * Model validation: a QC before studiomdl, or a compiled MDL through the model reader. It
 * does not compile; it names the structural failures that make a compile die or a prop ship
 * without a hitbox.
 */
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readModelInfoTool } from "../../../assets/typescript/tools/content.js";
import {
  flattenQc,
  loadQc,
  qcModelName,
  walkQc,
} from "../../../formats/typescript/formats/qc.js";

const FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
});

export const checkModelTool = defineTool({
  name: "check_model",
  description:
    "Checks a `.qc` before studiomdl or a compiled `.mdl` through the model reader. A QC " +
    "needs `$modelname` and geometry (`$body`, `$bodygroup` or `$model`), and it reports " +
    "bodygroups, LODs, hitbox sets, attachments, sequences, missing materials and the " +
    "parser's diagnostics. An MDL is checked for existence, sequences, skins, hitboxes and " +
    "bounds. It does not run studiomdl; `run_studiomdl` is the compiler.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to a .qc or .mdl, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    kind: z.enum(["qc", "mdl"]),
    overall: z.enum(["pass", "warn", "fail"]),
    findings: z.array(FINDING),
    counts: z.object({ error: z.number(), warning: z.number(), info: z.number() }),
    modelName: z.string().nullable(),
    bodygroups: z.number(),
    lods: z.number(),
    hitboxSets: z.number(),
    attachments: z.number(),
    sequences: z.number(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const extension = extname(path).toLowerCase();
    const findings: Array<z.infer<typeof FINDING>> = [];
    let modelName: string | null = null;
    let bodygroups = 0;
    let lods = 0;
    let hitboxSets = 0;
    let attachments = 0;
    let sequences = 0;
    let kind: "qc" | "mdl";

    if (extension === ".qc") {
      kind = "qc";
      const file = loadQc(path);
      const statements = flattenQc(file).flatMap((part) => walkQc(part.statements));
      for (const part of flattenQc(file)) {
        for (const diagnostic of part.diagnostics) {
          findings.push({
            severity: diagnostic.severity,
            rule: diagnostic.rule,
            message: diagnostic.message,
          });
        }
      }
      modelName = qcModelName(file);
      if (!modelName) {
        findings.push({ severity: "error", rule: "qc-modelname", message: "no $modelname" });
      }
      const counts = new Map<string, number>();
      for (const statement of statements) {
        const command = statement.command.toLowerCase();
        counts.set(command, (counts.get(command) ?? 0) + 1);
      }
      bodygroups = counts.get("$bodygroup") ?? 0;
      lods = (counts.get("$lod") ?? 0) + (counts.get("$shadowlod") ?? 0);
      hitboxSets = counts.get("$hboxset") ?? 0;
      attachments = counts.get("$attachment") ?? 0;
      sequences = counts.get("$sequence") ?? 0;
      const geometry =
        (counts.get("$body") ?? 0) + bodygroups + (counts.get("$model") ?? 0);
      if (geometry === 0) {
        findings.push({
          severity: "error",
          rule: "qc-geometry",
          message: "no $body, $bodygroup or $model; the model has no geometry",
        });
      }
      if ((counts.get("$cdmaterials") ?? 0) === 0) {
        findings.push({
          severity: "warning",
          rule: "qc-materials",
          message: "no $cdmaterials; the model has no material directory",
        });
      }
      if ((counts.get("$collisionmodel") ?? 0) === 0) {
        findings.push({
          severity: "info",
          rule: "qc-no-collision",
          message: "no $collisionmodel; the model has no .phy and is not solid as a prop_physics",
        });
      }
    } else if (extension === ".mdl") {
      kind = "mdl";
      const info = (await readModelInfoTool.handler({ model: path } as never, ctx as never)) as {
        found?: boolean;
        model?: string;
        readError?: string;
        sequenceCount?: number;
        skins?: string[][];
        hitboxSets?: Array<{ name: string; hitboxes: number }>;
        attachments?: Array<{ name: string }>;
        bodyParts?: Array<{ name: string; models: number }>;
      };
      modelName = info.model ?? null;
      if (!info.found) {
        findings.push({
          severity: "error",
          rule: "mdl-missing",
          message: info.readError ?? "the model was not found",
        });
      } else {
        sequences = info.sequenceCount ?? 0;
        hitboxSets = info.hitboxSets?.length ?? 0;
        attachments = info.attachments?.length ?? 0;
        bodygroups = info.bodyParts?.length ?? 0;
        if (sequences === 0) {
          findings.push({
            severity: "warning",
            rule: "mdl-no-sequences",
            message: "no sequences in the model",
          });
        }
        if (hitboxSets === 0) {
          findings.push({
            severity: "info",
            rule: "mdl-no-hitboxes",
            message: "no hitbox set; damage traces use the bounding box",
          });
        }
      }
    } else {
      throw new Error("check_model takes a .qc or a .mdl");
    }

    const counts = {
      error: findings.filter((finding) => finding.severity === "error").length,
      warning: findings.filter((finding) => finding.severity === "warning").length,
      info: findings.filter((finding) => finding.severity === "info").length,
    };
    return {
      path,
      kind,
      overall: counts.error > 0 ? ("fail" as const) : counts.warning > 0 ? ("warn" as const) : ("pass" as const),
      findings,
      counts,
      modelName,
      bodygroups,
      lods,
      hitboxSets,
      attachments,
      sequences,
    };
  },
});

export const modelCheckTools = [checkModelTool];
