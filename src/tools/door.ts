import { existsSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { placeDoor } from "../vmf/door.js";
import { readModelInfoTool } from "./content.js";
import { CONFIRM, DRY_RUN, BACKUP, BACKUP_PATH, resolveVmfInput } from "./paths.js";
import { editVmf } from "./vmfedit.js";

const VEC3 = z.array(z.number()).length(3);

const OPENING = z.object({
  axis: z.enum(["x", "y"]).describe("World axis the opening runs along."),
  min: z.number().describe("Opening extent on that axis."),
  max: z.number().describe("Opening extent on that axis."),
  at: z.number().describe("Position on the other horizontal axis: the plane of the door."),
  floorZ: z.number().describe("Floor height the bottom of the leaf should rest on."),
});

/**
 * A door's origin is its hinge. This tool is the only place that turns an opening and a
 * model's hull into that origin; placing the origin in the middle of the opening is the
 * failure behind the "half the doorway is open" bug.
 */
export const placeDoorTool = defineTool({
  name: "place_door",
  description:
    "Places a rotating door in an opening, with the entity origin on the hinge rather than " +
    "in the middle of the leaf. Reads the model's hull with read_model_info, computes the " +
    "hinge from the opening and the yaw, and writes the entity with the model, origin, " +
    "angles, optional targetname and spawnflags. For a safe-room door use " +
    "`prop_door_rotating_checkpoint` and the names `checkpoint_exit` / `checkpoint_entrance`; " +
    "the engine looks those names up. Refuses a door wider than its opening and a yaw that " +
    "runs the leaf across the opening. Run read_vmf_lint after; it checks swing clearance.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    model: z
      .string()
      .default("models/props_doors/checkpoint_door_-02.mdl")
      .describe("Door model; the models/ prefix and .mdl are added if missing."),
    classname: z
      .enum(["prop_door_rotating_checkpoint", "prop_door_rotating"])
      .default("prop_door_rotating_checkpoint")
      .describe("Checkpoint doors are looked up by name; a normal door is not."),
    opening: OPENING,
    yaw: z.number().describe("Entity yaw in degrees. The leaf must run along the opening."),
    targetname: z
      .string()
      .optional()
      .describe("For a checkpoint door: `checkpoint_exit` or `checkpoint_entrance`."),
    spawnflags: z
      .number()
      .optional()
      .describe("Defaults to 8192 for a checkpoint door, 0 for a normal one."),
    spawnpos: z
      .number()
      .optional()
      .describe("Door `spawnpos` keyvalue; defaults to 2 for a checkpoint door."),
    inset: z.number().default(2).describe("Distance from the jamb to the hinge origin."),
    keyvalues: z.record(z.string(), z.string()).optional(),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    entityId: z.number().nullable(),
    model: z.string(),
    origin: VEC3,
    hinge: z.enum(["min", "max"]),
    width: z.number(),
    extension: z.array(z.number()).length(2),
    warnings: z.array(z.string()),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);

    const model = args.model.startsWith("models/")
      ? args.model.endsWith(".mdl")
        ? args.model
        : `${args.model}.mdl`
      : `models/${args.model.endsWith(".mdl") ? args.model : `${args.model}.mdl`}`;
    const info = (await readModelInfoTool.handler({ model }, ctx)) as {
      found: boolean;
      mins: number[] | null;
      maxs: number[] | null;
      readError?: string;
    };
    if (!info.found || !info.mins || !info.maxs) {
      throw new Error(
        `cannot place ${model}: ${info.readError ?? "the model was not found"} ` +
          "(read_model_info is the model browser's answer)",
      );
    }

    const placement = placeDoor({
      bounds: {
        mins: [info.mins[0]!, info.mins[1]!, info.mins[2]!],
        maxs: [info.maxs[0]!, info.maxs[1]!, info.maxs[2]!],
      },
      opening: args.opening,
      yaw: args.yaw,
      inset: args.inset,
    });

    const warnings: string[] = [];
    if (args.classname === "prop_door_rotating_checkpoint") {
      if (args.targetname !== "checkpoint_exit" && args.targetname !== "checkpoint_entrance") {
        warnings.push(
          "a checkpoint door should be named `checkpoint_exit` (room being left) or " +
            "`checkpoint_entrance` (room being entered); the engine looks those names up",
        );
      }
      if (!args.targetname) {
        warnings.push("the checkpoint door has no targetname, so the transition logic cannot find it");
      }
    }

    const keyvalues: Record<string, string> = {
      classname: args.classname,
      model,
      origin: placement.origin.join(" "),
      angles: `0 ${args.yaw} 0`,
      spawnflags: String(
        args.spawnflags ?? (args.classname === "prop_door_rotating_checkpoint" ? 8192 : 0),
      ),
      ...(args.targetname ? { targetname: args.targetname } : {}),
      ...(args.spawnpos !== undefined
        ? { spawnpos: String(args.spawnpos) }
        : args.classname === "prop_door_rotating_checkpoint"
          ? { spawnpos: "2" }
          : {}),
      ...(args.keyvalues ?? {}),
    };

    const write = (await editVmf.handler(
      {
        path,
        ops: [{ op: "add", keyvalues }],
        dryRun: args.dryRun ?? false,
        backup: args.backup ?? true,
        confirm: true,
      },
      ctx,
    )) as {
      written: boolean;
      backupPath: string | null;
      outcomes: Array<{ ids: Array<number | null> }>;
    };

    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      entityId: write.outcomes[0]?.ids[0] ?? null,
      model,
      origin: placement.origin as [number, number, number],
      hinge: placement.hinge,
      width: Math.round(placement.width * 1000) / 1000,
      extension: placement.extension,
      warnings,
      note:
        "The origin is the hinge, inset from the jamb. The leaf extends " +
        `${placement.extension.map((v) => v.toFixed(2)).join(", ")}; check the swing volume ` +
        "with read_vmf_lint's `l4d2-door-swing-blocked` rule.",
    };
  },
});

export const doorTools = [placeDoorTool];
