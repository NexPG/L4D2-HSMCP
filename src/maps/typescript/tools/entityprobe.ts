/**
 * Runtime presence probes for entities with targetnames.
 *
 * A compiled BSP proves an entity was written, not that it exists when the map runs. A
 * screenshot proves even less for something invisible, such as a weapon spawner or an
 * infected border. The engine's own output system is the oracle: add an `OnUser1` output that
 * echoes a unique line through a `point_servercommand`, then fire `FireUser1` from
 * `run_map_test`'s schedule and match the line. If the entity is absent at runtime, nothing
 * echoes and the marker is missing.
 *
 * This is a primitive over `write_point_entity` and `edit_vmf`'s output writer, not a fixed
 * probe list: any targetname can be probed.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { addEntities, addOutputs, verifyEntities } from "./entityfamilies.js";
import { readEntities, type VmfEntity } from "../vmf/edit.js";

/** A name that is safe in an `echo` command and in a marker regex. */
function echoName(prefix: string, target: string): string {
  const tail = target
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${prefix}_${tail || "entity"}`;
}

export const writeEntityProbeTool = defineTool({
  name: "write_entity_probe",
  description:
    "Adds a runtime presence probe to every entity with the given targetname: an `OnUser1` " +
    "output that echoes a unique line through a `point_servercommand`. The result includes " +
    "the `schedule` and `markers` to pass to `run_map_test`; a missing echo means the entity " +
    "did not exist in the running map. Universal over targetnames, not a fixed list. " +
    "Compile after this call, then run the map. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    targets: z
      .array(z.string().min(1))
      .min(1)
      .describe("Targetnames to probe, exactly as they are in the VMF (case-insensitive)."),
    commandTarget: z
      .string()
      .min(1)
      .default("hsmcp_probe_cmd")
      .describe("Targetname of the point_servercommand the probes echo through."),
    echoPrefix: z
      .string()
      .min(1)
      .default("HSMCP_FOUND")
      .describe("Prefix of each echoed line; the sanitized targetname is appended."),
    output: z
      .string()
      .min(1)
      .default("OnUser1")
      .describe("Entity output to attach; pair it with the matching FireUser input."),
    event: z
      .string()
      .optional()
      .describe(
        "Attach the echo directly to this natural entity output instead of OnUser1. For " +
          "example `OnEndFollow` proves a point_viewcontrol was enabled and then released; " +
          "no logic_auto or schedule is needed.",
      ),
    fireInput: z
      .string()
      .min(1)
      .default("FireUser1")
      .describe("Input the schedule sends to the entity to fire the probe."),
    atSeconds: z
      .number()
      .int()
      .min(1)
      .max(600)
      .default(2)
      .describe("First scheduled second when `onMapSpawn` is false; each probe is one later."),
    onMapSpawn: z
      .boolean()
      .default(true)
      .describe(
        "Fire every probe from a `logic_auto` on OnMapSpawn, when the entities exist and " +
          "before the Director can remove a spawner. Set false to use the returned schedule.",
      ),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    commandEntityId: z.number().nullable(),
    autoEntityId: z.number().nullable(),
    commandTarget: z.string(),
    probes: z.array(
      z.object({
        target: z.string(),
        entityId: z.number().nullable(),
        classname: z.string(),
        echo: z.string(),
        fire: z.string(),
      }),
    ),
    schedule: z.array(z.object({ atSeconds: z.number(), command: z.string() })),
    markers: z.array(
      z.object({ name: z.string(), pattern: z.string(), withinSeconds: z.number() }),
    ),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const commandTarget = args.commandTarget ?? "hsmcp_probe_cmd";
    const echoPrefix = args.echoPrefix ?? "HSMCP_FOUND";
    const output = args.output ?? "OnUser1";
    const fireInput = args.fireInput ?? "FireUser1";
    const firstSecond = args.atSeconds ?? 2;
    const naturalEvent = args.event ?? null;
    const path = resolveVmfInput(args.path, ctx.config);
    const entities = readEntities(readFileSync(path, "utf8")).entities;
    const byName = new Map<string, VmfEntity>();
    for (const entity of entities) {
      if (entity.targetname) byName.set(entity.targetname.toLowerCase(), entity);
    }
    const missing = args.targets.filter((target) => !byName.has(target.toLowerCase()));
    if (missing.length > 0) {
      throw new Error(
        `no entity has targetname ${missing.map((name) => JSON.stringify(name)).join(", ")}; ` +
          `probe only names the VMF already contains`,
      );
    }
    const noId = args.targets.filter((target) => byName.get(target.toLowerCase())?.id == null);
    if (noId.length > 0) {
      throw new Error(
        `entity ${noId.join(", ")} has no Hammer id, so an output cannot be attached safely; ` +
          `open and resave the VMF in Hammer first`,
      );
    }

    let commandEntityId: number | null =
      entities.find(
        (entity) =>
          entity.classname.toLowerCase() === "point_servercommand" &&
          entity.targetname?.toLowerCase() === commandTarget.toLowerCase(),
      )?.id ?? null;
    if (commandEntityId === null) {
      const first = byName.get(args.targets[0]!.toLowerCase())!;
      const origin = first.keyvalues["origin"] ?? "0 0 0";
      const [id = null] = await addEntities(
        path,
        [
          {
            classname: "point_servercommand",
            targetname: commandTarget,
            origin,
          },
        ],
        ctx,
      );
      verifyEntities(path, [id], ["point_servercommand"]);
      commandEntityId = id;
    }

    const probes: Array<{
      target: string;
      entityId: number | null;
      classname: string;
      echo: string;
      fire: string;
    }> = [];
    const used = new Set<string>();
    for (const target of args.targets) {
      const entity = byName.get(target.toLowerCase())!;
      let echo = echoName(echoPrefix, target);
      for (let suffix = 2; used.has(echo.toLowerCase()); suffix += 1) {
        echo = `${echoName(echoPrefix, target)}_${suffix}`;
      }
      used.add(echo.toLowerCase());
      await addOutputs(
        path,
        entity.id!,
        [
          {
            output: naturalEvent ?? output,
            target: commandTarget,
            input: "Command",
            parameter: `echo ${echo}`,
            delay: 0,
            times: -1,
          },
        ],
        ctx,
      );
      probes.push({
        target,
        entityId: entity.id,
        classname: entity.classname,
        echo,
        fire: naturalEvent ?? fireInput,
      });
    }

    const fireOnSpawn = naturalEvent === null && (args.onMapSpawn ?? true);
    let autoEntityId: number | null = null;
    if (fireOnSpawn) {
      const first = byName.get(args.targets[0]!.toLowerCase())!;
      const [id = null] = await addEntities(
        path,
        [
          {
            classname: "logic_auto",
            targetname: `${commandTarget}_auto`,
            origin: first.keyvalues["origin"] ?? "0 0 0",
          },
        ],
        ctx,
      );
      verifyEntities(path, [id], ["logic_auto"]);
      await addOutputs(
        path,
        id!,
        probes.map((probe) => ({
          output: "OnMapSpawn",
          target: probe.target,
          input: probe.fire,
          parameter: "",
          delay: 0,
          times: -1,
        })),
        ctx,
      );
      autoEntityId = id;
    }

    // Re-read: the ids above were read before the command entity was added, and a caller
    // sees the final file, not an intermediate guess.
    const after = readEntities(readFileSync(path, "utf8")).entities;
    const stillThere = args.targets.filter((target) => {
      const entity = byName.get(target.toLowerCase())!;
      return !after.some((candidate) => candidate.id === entity.id);
    });
    if (stillThere.length > 0) {
      throw new Error(`probe write lost ${stillThere.join(", ")}; the VMF is not trustworthy`);
    }

    return {
      path,
      commandEntityId,
      autoEntityId,
      commandTarget: commandTarget,
      probes,
      schedule: naturalEvent
        ? []
        : probes.map((probe, index) => ({
            atSeconds: firstSecond + index,
            command: `ent_fire ${probe.target} ${probe.fire}`,
          })),
      markers: probes.map((probe) => ({
        name: `probe_${probe.echo.toLowerCase()}`,
        // A lookahead, not a bare substring: `..._camera` must not be satisfied by
        // `..._camera_timer`, which is written first and would hide a missing camera.
        pattern: `${probe.echo}(?![A-Za-z0-9_])`,
        withinSeconds: 60,
      })),
      nextStep:
        naturalEvent !== null
          ? `Compile the VMF, then call run_map_test with these markers. The marker appears ` +
            `when ${naturalEvent} fires on the entity; no schedule is needed.`
          : fireOnSpawn
            ? "Compile the VMF, then call run_map_test with only these markers. The logic_auto " +
              "fires each probe on OnMapSpawn; a missing marker is a real absence in the running map."
            : "Compile the VMF, then call run_map_test with these schedule and markers arrays. " +
              "A missing marker is a real absence in the running map, not a write failure.",
    };
  },
});

export const entityProbeTools = [writeEntityProbeTool];
