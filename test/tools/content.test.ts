import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readGameContentTool, readModelInfoTool } from "../../src/assets/typescript/tools/content.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const ready = has.sidecar && has.gameContent;

/**
 * These search the game's own VPKs through the Python sidecar, and one of them does it
 * three times. Vitest's default 5 s does not describe that work: on an idle machine the
 * file takes 16 s across fourteen tests, and under any load at all -- a `pnpm build` in the
 * same shell was enough -- the three-search case crossed the line at 5013 ms and went red.
 *
 * A flake nobody wrote down becomes a mystery, and a suite that fails for a reason unrelated
 * to the change under test is worse than a slow one. So the bound is stated, and it is
 * generous on purpose: it exists to catch a hang, not to police a duration nothing here
 * promises.
 */
const VPK_SEARCH_TIMEOUT = 60_000;

interface SearchReply {
  mounted: boolean;
  total: number;
  shown?: number;
  truncated?: boolean;
  results: Array<{
    path: string;
    name?: string;
    shader?: string | null;
    toolTexture?: boolean;
    resolves?: boolean;
    missingTextures?: string[];
  }>;
  error?: string;
}

interface ModelReply {
  found: boolean;
  mins?: number[] | null;
  maxs?: number[] | null;
  size?: number[] | null;
  skinCount?: number;
  sequences?: string[];
  materials?: string[];
  model: string;
  boneCount?: number;
  attachments?: Array<{ name: string; bone: number; boneName: string | null; position: number[] }>;
  bodyParts?: Array<{ name: string; models: number }>;
  hitboxSets?: Array<{ name: string; hitboxes: number }>;
}

const search = (args: Record<string, unknown>): Promise<SearchReply> =>
  readGameContentTool.handler(
    { kind: "material", limit: 100, ...args } as never,
    ctx,
  ) as unknown as Promise<SearchReply>;

describe("read_game_content", () => {
  it("allows an empty pattern in its schema, because empty means browse", () => {
    // The old refusal meant an agent could only find an asset whose name it already
    // guessed, which is how an installed escalator was never seen. This is the schema
    // check; the sidecar path is exercised by the game-backed tests below.
    expect(() => readGameContentTool.inputSchema.pattern.parse("")).not.toThrow();
  });

  it.skipIf(!ready)("finds a stock L4D2 material", async () => {
    const r = await search({ pattern: "brick_ext_01" });
    expect(r.mounted).toBe(true);
    expect(r.total).toBeGreaterThan(0);
    expect(r.results.map((x) => x.path)).toContain("materials/brick/brick_ext_01.vmt");
  }, VPK_SEARCH_TIMEOUT);

  it.skipIf(!ready)("returns the name in the form a .vmf stores, not the path", async () => {
    // The whole point of the tool: what comes out here goes straight into
    // set_face_material, with no prefix to strip and no case to fix.
    const r = await search({ pattern: "brick_ext_01" });
    const hit = r.results.find((x) => x.path === "materials/brick/brick_ext_01.vmt")!;
    expect(hit.name).toBe("BRICK/BRICK_EXT_01");
  }, VPK_SEARCH_TIMEOUT);

  it.skipIf(!ready)("treats a bare word as a substring and a starred one as a glob", async () => {
    // The glob must actually find something. Asserting only that it finds fewer than the
    // substring passes when it finds nothing at all, and `.every()` on an empty array is
    // vacuously true -- which is how a sabotage run that removed globbing stayed green.
    const substring = await search({ pattern: "brick" });
    const glob = await search({ pattern: "brick/brick*" });
    expect(glob.total).toBeGreaterThan(0);
    expect(substring.total).toBeGreaterThan(glob.total);
    expect(glob.results.every((x) => x.path.includes("brick/brick"))).toBe(true);

    // A wildcard in the middle is the case a substring match cannot express at all.
    const middle = await search({ pattern: "brick_ext_0?" });
    expect(middle.total).toBeGreaterThan(1);
  }, VPK_SEARCH_TIMEOUT);

  it.skipIf(!ready)("says how many it found, not only how many it returned", async () => {
    // A truncated list that reports its own length as the total is how a caller concludes
    // the game has four bricks.
    const r = await search({ pattern: "brick", limit: 2 });
    expect(r.results).toHaveLength(2);
    expect(r.shown).toBe(2);
    expect(r.total).toBeGreaterThan(2);
    expect(r.truncated).toBe(true);
  }, VPK_SEARCH_TIMEOUT);

  it.skipIf(!ready)("reads the shader only when asked, and marks tool textures", async () => {
    const plain = await search({ pattern: "brick_ext_01" });
    expect(plain.results[0]!.shader).toBeUndefined();

    const detailed = await search({ pattern: "brick_ext_01", details: true });
    expect(detailed.results[0]!.shader).toBe("LightmappedGeneric");
    expect(detailed.results[0]!.toolTexture).toBe(false);

    const tool = await search({ pattern: "tools/toolsnodraw", details: true });
    expect(tool.results[0]!.toolTexture).toBe(true);
  }, VPK_SEARCH_TIMEOUT);

  // #77. The upstream case was a GMod material whose .vtf did not ship. This install's
  // content has none to test against, so what remains here is the positive half: a
  // material that resolves is reported as resolving, and nothing is opened when details
  // were not requested.
  describe("material resolution (#77)", () => {
    it.skipIf(!ready)("reports a material that does draw as resolvable", async () => {
      const r = await search({ pattern: "brick/brick_ext_01", details: true });
      expect(r.results[0]!.resolves).toBe(true);
      expect(r.results[0]!.missingTextures).toEqual([]);
    }, VPK_SEARCH_TIMEOUT);

    it.skipIf(!ready)("says nothing about resolution when details were not asked for", async () => {
      const r = await search({ pattern: "brick/brick_ext_01" });
      expect(r.results[0]!.resolves).toBeUndefined();
    }, VPK_SEARCH_TIMEOUT);
  });

  it.skipIf(!ready)("finds models as well as materials", async () => {
    const r = await search({ pattern: "props_junk/gascan001a", kind: "model" });
    expect(r.results.map((x) => x.path)).toContain("models/props_junk/gascan001a.mdl");
  }, VPK_SEARCH_TIMEOUT);

  it.skipIf(!ready)("returns nothing, and says nothing is there, for a name that is not", async () => {
    const r = await search({ pattern: "no_such_material_anywhere_12345" });
    expect(r.mounted).toBe(true);
    expect(r.total).toBe(0);
    expect(r.results).toEqual([]);
  }, VPK_SEARCH_TIMEOUT);
});

describe("read_model_info", () => {
  const info = (model: string): Promise<ModelReply> =>
    readModelInfoTool.handler({ model } as never, ctx) as unknown as Promise<ModelReply>;

  it.skipIf(!ready)("measures a prop's own hull", async () => {
    // Measured 16/11/2026 against this install's gascan. The origin sits at the model's
    // centre, so placing it at a floor's own z buries half of it, and nothing downstream
    // reports that.
    const r = await info("props_junk/gascan001a");
    expect(r.found).toBe(true);
    expect(r.size![0]).toBeCloseTo(6.594, 2);
    expect(r.size![1]).toBeCloseTo(14.591, 2);
    expect(r.size![2]).toBeCloseTo(21.335, 2);
    expect(r.mins![2]).toBeLessThan(0);
    expect(r.maxs![2]).toBeGreaterThan(0);
  }, VPK_SEARCH_TIMEOUT);

  it.skipIf(!ready)("adds the prefix and the suffix a caller left off", async () => {
    const bare = await info("props_junk/gascan001a");
    const full = await info("models/props_junk/gascan001a.mdl");
    expect(bare.model).toBe("models/props_junk/gascan001a.mdl");
    expect(bare.size).toEqual(full.size);
  }, VPK_SEARCH_TIMEOUT);

  it.skipIf(!ready)("lists the skins and materials a mapper chooses between", async () => {
    const r = await info("props_junk/gascan001a");
    expect(r.skinCount).toBe(4);
    expect(r.materials!.length).toBeGreaterThan(0);
    expect(r.materials![0]).toMatch(/^materials\/models\//);
  }, VPK_SEARCH_TIMEOUT);

  it.skipIf(!ready)("names its sequences rather than dumping their internals", async () => {
    // srctools reprs a Sequence with its bounding box and its event list, a few hundred
    // characters each, answering a question nobody asked.
    const r = await info("props_junk/gascan001a");
    expect(r.sequences).toContain("idle");
    expect(r.sequences!.every((s) => typeof s === "string" && !s.includes("Sequence("))).toBe(true);
  }, VPK_SEARCH_TIMEOUT);

  it.skipIf(!ready)("reads the attachments a weapon model positions its effects with", async () => {
    // Measured 18/11/2026 against this install's v_rifle: 7 attachments over 65 bones.
    // The struct is 92 bytes here, not the 60 the older SDK documents, and the name index
    // is relative to the attachment itself -- reading it relative to the array puts every
    // name but the first two bytes out of place.
    const r = await info("v_models/v_rifle.mdl");
    expect(r.found).toBe(true);
    expect(r.boneCount).toBeGreaterThan(10);
    const names = (r.attachments ?? []).map((a) => a.name);
    expect(names).toContain("muzzlesmoke");
    expect(names).toContain("attach_muzzle");

    const muzzle = (r.attachments ?? []).find((a) => a.name === "attach_muzzle")!;
    expect(muzzle.boneName).toMatch(/ValveBiped\./);
    expect(muzzle.position).toHaveLength(3);
    // The muzzle sits forward of the origin, not at it: a model with every attachment at
    // 0 0 0 is the failure this catches.
    expect(Math.abs(muzzle.position[2]!)).toBeGreaterThan(1);

    expect(r.bodyParts?.length).toBeGreaterThan(0);
    expect(r.hitboxSets?.length).toBeGreaterThan(0);
  }, VPK_SEARCH_TIMEOUT);

  it.skipIf(!ready)("says a model is absent instead of failing", async () => {
    const r = await info("models/nope/nope.mdl");
    expect(r.found).toBe(false);
    expect(r.size ?? null).toBeNull();
  }, VPK_SEARCH_TIMEOUT);
});
