/**
 * Choreo scenes: text VCD timelines and the scenes.image summary. The parsers are
 * `srctools.choreo`; these tests check the fields the tools select and that a binary image is
 * refused by the VCD reader with a pointer to the other tool.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readChoreoTool, readScenesImageTool } from "../../src/scripts/typescript/tools/choreo.js";
import { ctx as sharedCtx, FIXTURES, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const sceneImage = sharedCtx.config.gameDir
  ? join(sharedCtx.config.gameDir, "scenes", "scenes.image")
  : "";

interface Event {
  name: string;
  type: string;
  start: number;
  end: number | null;
  actor?: string;
  channel?: string;
}

describe.skipIf(!has.sidecar)("read_choreo", () => {
  it("reads a VCD timeline, its actor channel and its sound", async () => {
    const reply = (await readChoreoTool.handler(
      { path: join(FIXTURES, "choreo_sample.vcd") },
      ctx,
    )) as unknown as {
      mapName: string;
      fps: number;
      duration: number;
      eventCount: number;
      events: Event[];
      actorCount: number;
      actors: Array<{ name: string; channels: Array<{ name: string; eventCount: number }> }>;
      sounds: string[];
      soundCount: number;
    };

    expect(reply.fps).toBe(60);
    expect(reply.duration).toBeGreaterThan(2.4);
    expect(reply.eventCount).toBe(2);
    expect(reply.actorCount).toBe(1);
    expect(reply.actors[0]!.name).toBe("actor_a");
    expect(reply.actors[0]!.channels[0]!.name).toBe("voice");
    expect(reply.actors[0]!.channels[0]!.eventCount).toBe(1);
    expect(reply.events.map((event) => event.type)).toEqual(["loop", "speak"]);
    const speak = reply.events.find((event) => event.type === "speak")!;
    expect(speak.name).toBe("campaign/test_line");
    expect(speak.actor).toBe("actor_a");
    expect(speak.channel).toBe("voice");
    expect(reply.sounds).toContain("campaign/test_line");
    expect(reply.soundCount).toBeGreaterThan(0);
  });

  it("refuses scenes.image and names the other tool", async () => {
    if (!existsSync(sceneImage)) return;
    await expect(readChoreoTool.handler({ path: sceneImage }, ctx)).rejects.toThrow(
      /use read_scenes_image/,
    );
  });
});

describe.skipIf(!has.sidecar || !has.gameContent)("read_scenes_image", () => {
  it("reads the stock scenes.image summary", async () => {
    if (!existsSync(sceneImage)) return;
    const reply = (await readScenesImageTool.handler(
      { path: sceneImage, limit: 5 },
      ctx,
    )) as unknown as {
      count: number;
      returned: number;
      truncated: boolean;
      entries: Array<{
        checksum: string;
        durationMs: number;
        sounds: string[];
        soundCount: number;
      }>;
    };
    expect(reply.count).toBeGreaterThan(0);
    expect(reply.returned).toBe(5);
    expect(reply.truncated).toBe(true);
    for (const entry of reply.entries) {
      expect(entry.checksum).toMatch(/^[0-9a-f]{8}$/);
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
      expect(entry.soundCount).toBe(entry.sounds.length);
    }
  });

  it("parses embedded scene details on request", async () => {
    if (!existsSync(sceneImage)) return;
    const reply = (await readScenesImageTool.handler(
      { path: sceneImage, limit: 1, details: true },
      ctx,
    )) as unknown as {
      entries: Array<{ eventCount?: number; actorCount?: number; detailError?: string }>;
    };
    expect(reply.entries[0]!.detailError).toBeUndefined();
    expect(reply.entries[0]!.eventCount).toBeGreaterThanOrEqual(0);
    expect(reply.entries[0]!.actorCount).toBeGreaterThanOrEqual(0);
  });
});
