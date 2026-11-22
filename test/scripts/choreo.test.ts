/**
 * Choreo scenes: text VCD timelines and the scenes.image summary. The parsers are
 * `srctools.choreo`; these tests check the fields the tools select and that a binary image is
 * refused by the VCD reader with a pointer to the other tool.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  editChoreoEventsTool,
  readChoreoTool,
  readScenesImageTool,
  writeScenesImageTool,
} from "../../src/scripts/typescript/tools/choreo.js";
import { ctx as sharedCtx, FIXTURES, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-choreo-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
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


describe.skipIf(!has.sidecar)("edit_choreo_events", () => {
  const copyFixture = (name: string): string => {
    const path = join(scratch, name);
    copyFileSync(join(FIXTURES, "choreo_sample.vcd"), path);
    return path;
  };

  it("retimes an event and swaps a speak sound, then reads both back", async () => {
    const path = copyFixture("edited.vcd");
    const result = (await editChoreoEventsTool.handler(
      {
        path,
        updates: [
          { name: "intro_loop", start: 0.75 },
          { name: "campaign/test_line", start: 1.2, end: 3.0, parameters: ["campaign/new_line"] },
        ],
        backup: true,
        confirm: true,
      } as never,
      ctx,
    )) as { verified: boolean; updated: number; eventCount: number; written: boolean };

    expect(result.written).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.updated).toBe(2);
    expect(result.eventCount).toBe(2);

    const read = (await readChoreoTool.handler({ path }, ctx)) as unknown as {
      events: Event[];
      sounds: string[];
      duration: number;
    };
    const loop = read.events.find((event) => event.name === "intro_loop")!;
    expect(loop.start).toBeCloseTo(0.75, 6);
    // The quoted name stays; the first parameter is the sound.
    const speak = read.events.find((event) => event.name === "campaign/test_line")!;
    expect(speak.start).toBeCloseTo(1.2, 6);
    expect(speak.end).toBeCloseTo(3.0, 6);
    expect(speak.type).toBe("speak");
    expect(speak.actor).toBe("actor_a");
    expect(read.sounds).toContain("campaign/new_line");
    expect(read.sounds).not.toContain("campaign/test_line");
    expect(read.duration).toBeCloseTo(3.0, 6);
    expect(existsSync(`${path}.bak`)).toBe(true);
  });

  it("adds a speak event and removes an existing loop", async () => {
    const path = copyFixture("add-remove.vcd");
    const result = (await editChoreoEventsTool.handler(
      {
        path,
        updates: [{ name: "intro_loop", remove: true }],
        add: [
          {
            type: "speak",
            name: "campaign/new_line",
            actor: "actor_a",
            channel: "voice",
            start: 3.0,
            end: 4.0,
            parameters: ["campaign/new_line"],
          },
        ],
        backup: true,
        confirm: true,
      } as never,
      ctx,
    )) as { verified: boolean; added: number; removed: number; eventCount: number };

    expect(result.verified).toBe(true);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.eventCount).toBe(2);

    const read = (await readChoreoTool.handler({ path }, ctx)) as unknown as {
      events: Event[];
      sounds: string[];
      duration: number;
    };
    expect(read.events.map((event) => event.name)).toEqual([
      "campaign/test_line",
      "campaign/new_line",
    ]);
    expect(read.events.find((event) => event.name === "campaign/new_line")!.start).toBeCloseTo(3, 6);
    expect(read.events.find((event) => event.name === "campaign/new_line")!.end).toBeCloseTo(4, 6);
    expect(read.sounds).toContain("campaign/new_line");
    expect(read.duration).toBeCloseTo(4, 6);
  });

  it("refuses an event that is not there and an empty update", async () => {
    const path = copyFixture("refused.vcd");
    const before = readFileSync(path);
    await expect(
      editChoreoEventsTool.handler(
        { path, updates: [{ name: "no_such_event", start: 1 }], confirm: true } as never,
        ctx,
      ),
    ).rejects.toThrow(/no event named "no_such_event"/);
    await expect(
      editChoreoEventsTool.handler(
        { path, updates: [{ name: "intro_loop" }], confirm: true } as never,
        ctx,
      ),
    ).rejects.toThrow(/changes nothing/);
    await expect(
      editChoreoEventsTool.handler(
        { path, updates: [{ name: "campaign/test_line", start: 4 }], confirm: true } as never,
        ctx,
      ),
    ).rejects.toThrow(/would end at 2\.5 before its start 4/);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("leaves the file alone on a dry run", async () => {
    const path = copyFixture("dry.vcd");
    const before = readFileSync(path);
    const result = (await editChoreoEventsTool.handler(
      {
        path,
        updates: [{ name: "intro_loop", start: 0.9 }],
        dryRun: true,
        backup: true,
        confirm: true,
      } as never,
      ctx,
    )) as { written: boolean; verified: boolean; backup: string | null };
    expect(result.verified).toBe(true);
    expect(result.written).toBe(false);
    expect(result.backup).toBeNull();
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it.skipIf(!has.gameContent)("edits a stock L4D2 dialogue scene", async () => {
    const source = join(ctx.config.gameDir!, "scenes", "coach", "adrenaline01.vcd");
    if (!existsSync(source)) return;
    const path = join(scratch, "adrenaline01.vcd");
    copyFileSync(source, path);
    const result = (await editChoreoEventsTool.handler(
      {
        path,
        updates: [
          {
            name: "SpeakEvent",
            actor: "Coach",
            channel: "audio",
            start: 0.2,
            end: 1.5,
            parameters: ["Coach_Adrenaline02"],
          },
        ],
        backup: true,
        confirm: true,
      } as never,
      ctx,
    )) as { verified: boolean; updated: number; eventCount: number };
    expect(result.verified).toBe(true);
    expect(result.updated).toBe(1);
    expect(result.eventCount).toBe(4);

    const read = (await readChoreoTool.handler({ path }, ctx)) as unknown as {
      events: Event[];
      sounds: string[];
    };
    const speak = read.events.find((event) => event.name === "SpeakEvent")!;
    expect(speak.start).toBeCloseTo(0.2, 6);
    expect(speak.end).toBeCloseTo(1.5, 6);
    expect(read.sounds).toEqual(["Coach_Adrenaline02"]);
  }, 120_000);
});


describe.skipIf(!has.sidecar)("write_scenes_image", () => {
  it("builds a scenes.image that the reader finds again", async () => {
    const out = join(scratch, "scenes.image");
    const result = (await writeScenesImageTool.handler(
      {
        paths: [join(FIXTURES, "choreo_sample.vcd")],
        path: out,
        version: 3,
        backup: true,
        confirm: true,
      } as never,
      ctx,
    )) as {
      written: boolean;
      verified: boolean;
      count: number;
      entries: Array<{ durationMs: number; sounds: string[] }>;
    };
    expect(result.written).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.count).toBe(1);
    expect(result.entries[0]!.durationMs).toBe(2500);
    expect(result.entries[0]!.sounds).toContain("campaign/test_line");

    const reader = (await readScenesImageTool.handler(
      { path: out, limit: 10 },
      ctx,
    )) as unknown as {
      count: number;
      entries: Array<{ sounds: string[]; durationMs: number }>;
    };
    expect(reader.count).toBe(1);
    expect(reader.entries[0]!.sounds).toContain("campaign/test_line");
    expect(reader.entries[0]!.durationMs).toBe(2500);

    await expect(
      writeScenesImageTool.handler(
        { paths: [join(FIXTURES, "choreo_sample.vcd")], path: out, confirm: true } as never,
        ctx,
      ),
    ).rejects.toThrow(/already exists/);

    const dryOut = join(scratch, "dry-scenes.image");
    const dry = (await writeScenesImageTool.handler(
      {
        paths: [join(FIXTURES, "choreo_sample.vcd")],
        path: dryOut,
        dryRun: true,
        confirm: true,
      } as never,
      ctx,
    )) as { written: boolean; verified: boolean };
    expect(dry.written).toBe(false);
    expect(dry.verified).toBe(true);
    expect(existsSync(dryOut)).toBe(false);
  }, 120_000);
});
