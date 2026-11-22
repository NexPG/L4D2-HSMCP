/**
 * Nav records, not area bits: a ladder and a hiding spot are fixed-size records, so a write
 * must leave every other offset where it was. The tests use the stock campaign nav, where
 * both kinds exist, and read the changed values back through the existing readers.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readNavHidingSpotsTool, readNavPlacesTool } from "../../src/nav/typescript/tools/navdetails.js";
import {
  readNavLaddersTool,
  writeNavHidingSpotsTool,
  writeNavLaddersTool,
  writeNavPlacesTool,
} from "../../src/nav/typescript/tools/navwrite.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-navwrite-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const source = (): string => join(ctx.config.gameDir!, "maps", "c2m1_highway.nav");
const available = has.gameContent && existsSync(source());

describe.skipIf(!available)("nav record writes", () => {
  it("patches a ladder and a hiding spot without moving the file", () => {
    const path = join(scratch, "nav.nav");
    copyFileSync(source(), path);
    const bytes = statSync(path).size;

    const ladders = readNavLaddersTool.handler({ path, limit: 100 } as never, ctx) as {
      count: number;
      ladders: Array<{
        id: number;
        width: number;
        top: [number, number, number];
        bottom: [number, number, number];
      }>;
    };
    expect(ladders.count).toBeGreaterThan(0);
    const ladder = ladders.ladders[0]!;
    const width = ladder.width + 2;
    const top: [number, number, number] = [ladder.top[0] + 4, ladder.top[1], ladder.top[2]];
    const ladderWrite = writeNavLaddersTool.handler(
      { path, updates: [{ id: ladder.id, width, top }], backup: true, confirm: true } as never,
      ctx,
    ) as { written?: boolean; verified: boolean; backup: string | null; bytes: number };
    expect(ladderWrite.verified).toBe(true);
    expect(ladderWrite.backup).not.toBeNull();
    expect(ladderWrite.bytes).toBe(bytes);

    const spots = readNavHidingSpotsTool.handler({ path, limit: 100 } as never, ctx) as {
      spots: Array<{
        id: number;
        areaId: number;
        position: [number, number, number];
        flags: number;
      }>;
    };
    expect(spots.spots.length).toBeGreaterThan(0);
    const spot = spots.spots[0]!;
    const moved: [number, number, number] = [
      spot.position[0] + 8,
      spot.position[1],
      spot.position[2],
    ];
    const spotWrite = writeNavHidingSpotsTool.handler(
      {
        path,
        updates: [{ areaId: spot.areaId, spotId: spot.id, x: moved[0] }],
        backup: true,
        confirm: true,
      } as never,
      ctx,
    ) as { verified: boolean; bytes: number };
    expect(spotWrite.verified).toBe(true);
    expect(spotWrite.bytes).toBe(bytes);

    const afterLadders = readNavLaddersTool.handler({ path, limit: 100 } as never, ctx) as {
      ladders: Array<{ id: number; width: number; top: [number, number, number] }>;
    };
    expect(afterLadders.ladders.find((entry) => entry.id === ladder.id)!.width).toBe(width);
    expect(afterLadders.ladders.find((entry) => entry.id === ladder.id)!.top).toEqual(top);
    const afterSpots = readNavHidingSpotsTool.handler({ path, limit: 100 } as never, ctx) as {
      spots: Array<{ id: number; areaId: number; position: [number, number, number] }>;
    };
    expect(
      afterSpots.spots.find(
        (entry) => entry.id === spot.id && entry.areaId === spot.areaId,
      )!.position[0],
    ).toBe(moved[0]);
    expect(readFileSync(path).length).toBe(bytes);
  });

  it("adds and renames a place without renumbering the others", () => {
    const path = join(scratch, "places.nav");
    copyFileSync(join(ctx.config.gameDir!, "maps", "c5m4_quarter.nav"), path);
    const before = readNavPlacesTool.handler({ path, limit: 500 } as never, ctx) as {
      placeCount: number;
      entries: Array<{ id: number; name: string | null; areaCount: number }>;
    };
    expect(before.placeCount).toBeGreaterThan(0);
    const originalNames = new Map(before.entries.map((entry) => [entry.id, entry.name]));
    const firstArea = readNavHidingSpotsTool.handler({ path, limit: 1 } as never, ctx) as {
      spots: Array<{ areaId: number; place: string | null }>;
    };
    const placeBefore = firstArea.spots[0]?.place ?? null;

    const added = writeNavPlacesTool.handler(
      { path, add: ["HSMCP Test Place"], backup: true, confirm: true } as never,
      ctx,
    ) as { verified: boolean; placeCount: number; added: number };
    expect(added.verified).toBe(true);
    expect(added.added).toBe(1);
    expect(added.placeCount).toBe(before.placeCount + 1);

    const afterAdd = readNavPlacesTool.handler({ path, limit: 500 } as never, ctx) as {
      entries: Array<{ id: number; name: string | null }>;
    };
    const newId = before.placeCount + 1;
    expect(afterAdd.entries.find((entry) => entry.id === newId)?.name).toBe("HSMCP Test Place");

    const renamed = writeNavPlacesTool.handler(
      {
        path,
        rename: [{ from: "HSMCP Test Place", to: "HSMCP Renamed Place" }],
        backup: true,
        confirm: true,
      } as never,
      ctx,
    ) as { verified: boolean };
    expect(renamed.verified).toBe(true);

    const afterRename = readNavPlacesTool.handler({ path, limit: 500 } as never, ctx) as {
      placeCount: number;
      entries: Array<{ id: number; name: string | null }>;
    };
    expect(afterRename.placeCount).toBe(before.placeCount + 1);
    expect(afterRename.entries.find((entry) => entry.id === newId)?.name).toBe(
      "HSMCP Renamed Place",
    );
    for (const [id, name] of originalNames) {
      expect(afterRename.entries.find((entry) => entry.id === id)?.name).toBe(name);
    }
    const afterSpots = readNavHidingSpotsTool.handler({ path, limit: 1 } as never, ctx) as {
      spots: Array<{ areaId: number; place: string | null }>;
    };
    expect(afterSpots.spots[0]?.place).toBe(placeBefore);
  });
});
