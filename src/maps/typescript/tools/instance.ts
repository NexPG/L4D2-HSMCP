import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock, KvPair } from "../../../formats/typescript/kv/parse.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { editVmf } from "./vmfedit.js";

const VEC3 = z.array(z.number()).length(3);

// base.fgd: 0 = prefix, 1 = postfix, 2 = none.
const FIXUP = { prefix: "0", postfix: "1", none: "2" } as const;

function value(block: KvBlock, key: string): string | null {
  const found = block.entries.find(
    (e): e is KvPair => e.kind === "pair" && e.key.toLowerCase() === key.toLowerCase(),
  );
  return found?.value ?? null;
}

function blocks(nodes: ReturnType<typeof parse>): KvBlock[] {
  return nodes.filter((n): n is KvBlock => n.kind === "block");
}

/** Counts what an instance file contains and whether it nests another instance. */
export function inspectInstance(text: string): {
  entities: number;
  solids: number;
  nested: boolean;
} {
  const roots = blocks(parse(text));
  const entities = roots.filter((b) => b.name === "entity");
  let solids = 0;
  for (const node of roots) {
    for (const entry of node.entries) {
      if (entry.kind === "block" && entry.name === "solid") solids++;
    }
  }
  const nested = entities.some((e) => (value(e, "classname") ?? "").toLowerCase() === "func_instance");
  return { entities: entities.length, solids, nested };
}

export const writeInstance = defineTool({
  name: "write_instance",
  description:
    "Places a Hammer instance: adds a `func_instance` entity pointing at an instance .vmf, " +
    "with an origin, angles and a fixup style. The file is resolved next to the target map " +
    "and read first, so a typo is an error instead of a silently empty instance; nested " +
    "instances are reported. Instances are how a mapper reuses a building or a set piece " +
    "without copying its brushes into every map. Guarded.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("The target .vmf."),
    file: z
      .string()
      .describe(
        'Instance .vmf, e.g. "instance/my_building.vmf". Relative paths resolve from the ' +
          "target map's directory.",
      ),
    origin: VEC3.describe("Where the instance origin lands."),
    angles: z.string().default("0 0 0").describe("Pitch yaw roll, as Hammer writes it."),
    fixupStyle: z.enum(["none", "prefix", "postfix"]).default("prefix"),
    targetname: z.string().optional().describe("Fix Up Name, used by outputs."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    entityId: z.number().nullable(),
    file: z.string(),
    instanceEntities: z.number(),
    instanceSolids: z.number(),
    warnings: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const target = resolveVmfInput(args.path, ctx.config);
    const instancePath = isAbsolute(args.file)
      ? args.file
      : resolve(dirname(target), args.file);

    if (!existsSync(instancePath)) {
      throw new Error(
        `instance not found: ${instancePath}. It resolves from ${dirname(target)}; check the ` +
          `path and that the file is the instance, not the map that uses it`,
      );
    }
    const text = readFileSync(instancePath, "utf8");
    const info = inspectInstance(text);
    if (info.solids === 0 && info.entities === 0) {
      throw new Error(`${instancePath} has no world solids and no entities; it is not an instance`);
    }

    const warnings: string[] = [];
    if (info.nested) {
      warnings.push("the instance contains another func_instance; nested instances need the fixup style to be right");
    }
    if (isAbsolute(args.file)) {
      warnings.push("an absolute instance path is machine-specific; use a path relative to the map");
    }

    const keyvalues: Record<string, string> = {
      classname: "func_instance",
      file: args.file.replace(/\\/g, "/"),
      origin: args.origin.join(" "),
      angles: args.angles,
      fixup_style: FIXUP[args.fixupStyle],
    };
    if (args.targetname) keyvalues["targetname"] = args.targetname;

    const edit = (await editVmf.handler(
      {
        path: target,
        ops: [{ op: "add", keyvalues }],
        backup: false,
        dryRun: false,
        confirm: true,
      },
      ctx,
    )) as { outcomes: Array<{ ids: number[] }> };

    return {
      entityId: edit.outcomes[0]?.ids[0] ?? null,
      file: keyvalues["file"]!,
      instanceEntities: info.entities,
      instanceSolids: info.solids,
      warnings,
    };
  },
});

export const instanceTools = [writeInstance];
