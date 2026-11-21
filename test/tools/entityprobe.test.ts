import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { writePointEntityTool } from "../../src/maps/typescript/tools/entityfamilies.js";
import { writeEntityProbeTool } from "../../src/maps/typescript/tools/entityprobe.js";
import { readEntities } from "../../src/maps/typescript/vmf/edit.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-probe-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n}\n';

let counter = 0;
function map(): string {
  counter += 1;
  const path = join(scratch, `probe-${counter}.vmf`);
  writeFileSync(path, SEED);
  return path;
}

async function point(path: string, classname: string, targetname: string): Promise<number> {
  const result = (await writePointEntityTool.handler(
    {
      path,
      classname,
      targetname,
      origin: [64, 64, 64],
      keyvalues: {},
      outputs: [],
      confirm: true,
    } as never,
    ctx,
  )) as { entityId: number };
  return result.entityId;
}

describe("write_entity_probe", () => {
  it("adds one echo output per target and returns a runnable schedule", async () => {
    const path = map();
    await point(path, "info_player_start", "spawn");
    await point(path, "light", "lamp");

    const result = (await writeEntityProbeTool.handler(
      {
        path,
        targets: ["spawn", "lamp"],
        atSeconds: 3,
        confirm: true,
      } as never,
      ctx,
    )) as {
      commandEntityId: number;
      autoEntityId: number;
      probes: Array<{ target: string; echo: string }>;
      schedule: Array<{ atSeconds: number; command: string }>;
      markers: Array<{ pattern: string }>;
    };

    expect(result.commandEntityId).toBeGreaterThan(0);
    expect(result.autoEntityId).toBeGreaterThan(0);
    expect(result.probes.map((probe) => probe.target)).toEqual(["spawn", "lamp"]);
    expect(result.probes.map((probe) => probe.echo)).toEqual([
      "HSMCP_FOUND_spawn",
      "HSMCP_FOUND_lamp",
    ]);
    expect(result.schedule).toEqual([
      { atSeconds: 3, command: "ent_fire spawn FireUser1" },
      { atSeconds: 4, command: "ent_fire lamp FireUser1" },
    ]);
    expect(result.markers.map((marker) => marker.pattern)).toEqual([
      "HSMCP_FOUND_spawn(?![A-Za-z0-9_])",
      "HSMCP_FOUND_lamp(?![A-Za-z0-9_])",
    ]);

    const entities = readEntities(readFileSync(path, "utf8")).entities;
    const command = entities.find((entity) => entity.id === result.commandEntityId)!;
    expect(command.classname).toBe("point_servercommand");
    expect(command.targetname).toBe("hsmcp_probe_cmd");
    const text = readFileSync(path, "utf8");
    expect(text).toContain("hsmcp_probe_cmd,Command,echo HSMCP_FOUND_spawn");
    expect(text).toContain("hsmcp_probe_cmd,Command,echo HSMCP_FOUND_lamp");
    expect(text.match(/OnUser1/g)).toHaveLength(2);
    expect(text.match(/OnMapSpawn/g)).toHaveLength(2);
    const auto = entities.find((entity) => entity.id === result.autoEntityId)!;
    expect(auto.classname).toBe("logic_auto");
    expect(auto.targetname).toBe("hsmcp_probe_cmd_auto");
  });

  it("reuses an existing command entity instead of adding a second", async () => {
    const path = map();
    await point(path, "info_player_start", "spawn");
    await point(path, "point_servercommand", "hsmcp_probe_cmd");
    await writeEntityProbeTool.handler({ path, targets: ["spawn"], confirm: true } as never, ctx);
    const commands = readEntities(readFileSync(path, "utf8")).entities.filter(
      (entity) => entity.classname === "point_servercommand",
    );
    expect(commands).toHaveLength(1);
  });

  it("refuses a targetname the VMF does not contain", async () => {
    const path = map();
    await point(path, "info_player_start", "spawn");
    await expect(
      writeEntityProbeTool.handler(
        { path, targets: ["spawn", "missing_name"], confirm: true } as never,
        ctx,
      ),
    ).rejects.toThrow(/missing_name/);
  });

  it("attaches a natural output and skips the OnMapSpawn logic", async () => {
    const path = map();
    await point(path, "point_viewcontrol", "camera");
    const result = (await writeEntityProbeTool.handler(
      { path, targets: ["camera"], event: "OnEndFollow", confirm: true } as never,
      ctx,
    )) as {
      autoEntityId: number | null;
      schedule: unknown[];
      probes: Array<{ fire: string }>;
    };
    expect(result.autoEntityId).toBeNull();
    expect(result.schedule).toEqual([]);
    expect(result.probes[0]!.fire).toBe("OnEndFollow");
    const text = readFileSync(path, "utf8");
    expect(text).toContain("OnEndFollow");
    expect(text).toContain("echo HSMCP_FOUND_camera");
    expect(text).not.toContain("OnMapSpawn");
  });

  it("sanitizes a targetname into an echo the console can carry", async () => {
    const path = map();
    await point(path, "info_player_start", "Intro Camera/01");
    const result = (await writeEntityProbeTool.handler(
      { path, targets: ["Intro Camera/01"], confirm: true } as never,
      ctx,
    )) as { probes: Array<{ echo: string }> };
    expect(result.probes[0]!.echo).toBe("HSMCP_FOUND_intro_camera_01");
  });
});
