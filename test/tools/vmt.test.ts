/**
 * Materials: the file between a face and its texture.
 *
 * The interesting assertions are the ones that come from real shipped files rather than
 * from a tidy example: a `patch` that only says `include`, a `Proxies` block nested two
 * levels deep, and a file that never closes its last brace — which Valve's own Portal 2 DLC
 * contains and the engine accepts. The last test pulls real `.vmt` files out of the game's
 * own archive, when this machine has one, because a parser that only agrees with itself is
 * not evidence of anything.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyVmtPatch,
  parseVmt,
  serializeVmt,
  vmtCompileFlags,
  vmtParameter,
  vmtTextures,
  vmtTree,
} from "../../src/formats/typescript/formats/vmt.js";
import { readVpk, readVpkEntry, vpkArchivePath } from "../../src/formats/typescript/formats/vpk.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readVmtTool, writeVmtTool, editVmtTool } from "../../src/textures/typescript/tools/vmt.js";
import { checkVmtTool } from "../../src/textures/typescript/tools/vmtcheck.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const editVmt = (args: Record<string, unknown>) => editVmtTool.handler(args as never, ctx);
const scratch = mkdtempSync(join(tmpdir(), "hammer-vmt-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const WALL = `// a comment the engine ignores
"LightmappedGeneric"
{
	"$basetexture" "concrete/cinderwall02"
	"$surfaceprop" "concrete"
	"%compileclip" "1"
	"$envmap" "env_cubemap"
	"Proxies"
	{
		"AnimatedTexture"
		{
			"animatedtexturevar" "$basetexture"
			"animatedtextureframenumvar" "$frame"
			"animatedtextureframerate" "10"
		}
	}
}
`;

describe("vmt format", () => {
  it("reads the shader, the parameters and a nested block", () => {
    const doc = parseVmt(WALL, "wall.vmt");
    expect(doc.shader).toBe("LightmappedGeneric");
    expect(vmtParameter(doc, "$BaseTexture")).toBe("concrete/cinderwall02");
    expect(vmtParameter(doc, "$SURFACEPROP")).toBe("concrete");
    expect(doc.blocks.get("proxies")?.length).toBe(1);
    expect(doc.appendedBraces).toBe(0);
    expect(doc.warnings).toEqual([]);
  });

  it("says which parameters are textures and which decide brush solidity", () => {
    const doc = parseVmt(WALL);
    expect(vmtTextures(doc)).toEqual([
      { key: "$basetexture", texture: "concrete/cinderwall02" },
      { key: "$envmap", texture: "env_cubemap" },
    ]);
    expect(vmtCompileFlags(doc)).toEqual({ "%compileclip": "1" });
  });

  it("treats a patch's include as a parameter and merges it like the engine", () => {
    const base = parseVmt(WALL);
    const patch = parseVmt(`"patch"
{
	"include" "materials/concrete/cinderwall02.vmt"
	"replace"
	{
		"$basetexture" "concrete/wall_new"
	}
	"insert"
	{
		"$phong" "1"
	}
}`);
    expect(vmtParameter(patch, "include")).toBe("materials/concrete/cinderwall02.vmt");
    expect(patch.blocks.has("replace")).toBe(true);

    const merged = applyVmtPatch(base, patch);
    expect(merged["$basetexture"]).toBe("concrete/wall_new");
    expect(merged["$phong"]).toBe("1");
    // insert does not overwrite what the base already has
    expect(merged["$surfaceprop"]).toBe("concrete");
  });

  it("repairs a missing closing brace and says how many it invented", () => {
    const doc = parseVmt(
      `"UnlitGeneric"\n{\n\t"$basetexture" "vgui/white"\n\t"Proxies"\n\t{\n\t\t"AnimatedTexture"\n\t\t{\n\t\t\t"animatedtexturevar" "$basetexture"\n`,
      "broken.vmt",
    );
    expect(doc.shader).toBe("UnlitGeneric");
    expect(doc.appendedBraces).toBe(3);
    expect(doc.warnings[0]).toMatch(/closing brace/);
    expect(vmtParameter(doc, "$basetexture")).toBe("vgui/white");
  });

  it("refuses what is not a material instead of repairing it into one", () => {
    expect(() => parseVmt("just some words\n{ }")).toThrow(/shader name followed by a block/);
    expect(() => parseVmt(`"VertexLitGeneric" "not a block"`)).toThrow(/shader name followed by a block/);
  });

  it("reports a repeated key rather than promising which one wins", () => {
    const doc = parseVmt(`"VertexLitGeneric"\n{\n\t"$basetexture" "a"\n\t"$basetexture" "b"\n}`);
    expect(doc.duplicates).toEqual(["$basetexture"]);
    expect(doc.warnings[0]).toMatch(/repeated/);
  });

  it("writes a tree back with nesting at the right depth", () => {
    const doc = parseVmt(WALL);
    const text = serializeVmt(doc.shader, vmtTree(doc));
    const lines = text.split("\n");
    const indentOf = (line: string): number => line.length - line.trimStart().length;
    const find = (needle: string): string => lines.find((l) => l.includes(needle)) ?? "";

    // The shader sits at column zero, a parameter one level in, Proxies one, and the
    // contents of Proxies three. A writer that pads and prefixes together lands a level deep.
    expect(lines[0]!.trim()).toBe('"LightmappedGeneric"');
    expect(indentOf(lines[0]!)).toBe(0);
    expect(lines[1]!.trim()).toBe("{");
    expect(indentOf(find("$basetexture"))).toBe(1);
    expect(find("$basetexture").trim().split(/\t/)).toEqual([
      '"$basetexture"',
      '"concrete/cinderwall02"',
    ]);
    expect(indentOf(find('"Proxies"'))).toBe(1);
    expect(indentOf(find('"animatedtexturevar"'))).toBe(3);

    // And it parses back to the same parameters.
    const again = parseVmt(text);
    expect(vmtParameter(again, "$basetexture")).toBe("concrete/cinderwall02");
    expect(again.blocks.get("proxies")?.length).toBe(1);
  });
});

describe("vmt tools", () => {
  it("writes a material and reads it back with its blocks intact", async () => {
    const path = join(scratch, "materials", "maps", "test_wall.vmt");
    const written = (await writeVmtTool.handler(
      {
        path,
        shader: "LightmappedGeneric",
        values: {
          $basetexture: "maps/test_wall",
          $surfaceprop: "concrete",
          "%compileclip": 1,
          Proxies: { TextureScroll: { textureScrollVar: "$basetexture", textureScrollRate: 5 } },
        },
        overwrite: false,
        confirm: true,
      },
      ctx,
    )) as { written: boolean; parameterCount: number };

    expect(written.written).toBe(true);
    expect(written.parameterCount).toBe(4);
    expect(readFileSync(path, "utf8")).toContain('"$basetexture"\t"maps/test_wall"');

    const read = (await readVmtTool.handler({ path }, ctx)) as {
      shader: string;
      baseTexture: string | null;
      surfaceProp: string | null;
      blocks: Array<{ name: string }>;
      compileFlags: Record<string, string>;
      warnings: string[];
      tree: Record<string, unknown>;
    };
    expect(read.shader).toBe("LightmappedGeneric");
    expect(read.baseTexture).toBe("maps/test_wall");
    expect(read.surfaceProp).toBe("concrete");
    expect(read.blocks.map((b) => b.name)).toEqual(["proxies"]);
    expect(read.compileFlags).toEqual({ "%compileclip": "1" });
    expect(read.tree).toMatchObject({
      $basetexture: "maps/test_wall",
      Proxies: { TextureScroll: { textureScrollRate: "5" } },
    });
    expect(read.warnings).toEqual([]);

    expect(() =>
      writeVmtTool.handler({ path, shader: "UnlitGeneric", values: {}, overwrite: false, confirm: true }, ctx),
    ).toThrow(/already exists/);
  });

  it("refuses a shader that cannot be written", () => {
    const path = join(scratch, "materials", "bad.vmt");
    expect(() =>
      writeVmtTool.handler(
        { path, shader: 'Bad"Shader', values: {}, overwrite: false, confirm: true },
        ctx,
      ),
    ).toThrow(/quote, a brace or a newline/);
    expect(existsSync(path)).toBe(false);
  });

  it.skipIf(ctx.config.gameDir === null)("parses real materials from the game archive", () => {
    const dir = join(ctx.config.gameDir as string, "pak01_dir.vpk");
    if (!existsSync(dir)) return;
    const archive = readVpk(readFileSync(dir), dir);
    const opened = new Map<number, Buffer | undefined>();
    const openArchive = (index: number): Buffer | undefined => {
      if (!opened.has(index)) {
        const path = vpkArchivePath(dir, index);
        opened.set(index, existsSync(path) ? readFileSync(path) : undefined);
      }
      return opened.get(index);
    };

    // 300 of L4D2's 4645 materials: enough to meet every shader family, and every way a
    // real file deviates from a tidy example. Measured on 18/11/2026: 0 failures, 83 patches
    // and 31 Proxies blocks in the first 3000 — the sample here is smaller but the point is
    // that a parser which only agrees with itself is not evidence.
    const materials = archive.entries
      .filter((e) => e.path.toLowerCase().endsWith(".vmt"))
      .slice(0, 300);
    expect(materials.length).toBeGreaterThan(0);

    let patches = 0;
    const failures: string[] = [];
    for (const entry of materials) {
      try {
        const text = readVpkEntry(archive, entry, openArchive).toString("utf8");
        const doc = parseVmt(text, entry.path);
        expect(doc.shader.length, entry.path).toBeGreaterThan(0);
        expect(doc.entries.length, entry.path).toBeGreaterThan(0);
        if (doc.shader.toLowerCase() === "patch") {
          patches += 1;
          expect(doc.parameters.get("include"), entry.path).toBeTruthy();
        }
      } catch (error) {
        failures.push(`${entry.path}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
    // L4D2 ships patches for its reskins; seeing none means the sample or the parser is wrong.
    expect(patches).toBeGreaterThan(0);
  }, 120_000);
});

describe("edit_vmt", () => {
  function material(name: string, source = WALL): string {
    const path = join(scratch, name);
    writeFileSync(path, source, "utf8");
    return path;
  }

  it("replaces one value and leaves the comment and the Proxies block alone", () => {
    const path = material("edit-base.vmt");
    const r = editVmt({
      path,
      edits: [{ path: ["$basetexture"], value: "concrete/wall_new" }],
    }) as {
      written: boolean;
      verified: boolean;
      edits: Array<{ previous: string; value: string }>;
    };
    expect(r.written).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.edits[0]!.previous).toBe("concrete/cinderwall02");
    const text = readFileSync(path, "utf8");
    expect(text).toContain('"$basetexture" "concrete/wall_new"');
    expect(text).toContain("// a comment the engine ignores");
    expect(text).toContain('"%compileclip" "1"');
    expect(text).toContain('"animatedtextureframerate" "10"');
  });

  it("edits a value nested inside Proxies and reads it back", () => {
    const path = material("edit-proxy.vmt");
    const r = editVmt({
      path,
      edits: [
        {
          path: ["Proxies", "AnimatedTexture", "animatedtextureframerate"],
          value: "12",
        },
      ],
    }) as { edits: Array<{ path: string[]; value: string }> };
    expect(r.edits[0]!.value).toBe("12");
    expect(readFileSync(path, "utf8")).toContain('"animatedtextureframerate" "12"');
    const read = readVmtTool.handler({ path }, ctx) as { tree: Record<string, unknown> };
    expect(read.tree).toMatchObject({
      Proxies: { AnimatedTexture: { animatedtextureframerate: "12" } },
    });
  });

  it("refuses a missing block or key and writes nothing", () => {
    const path = material("edit-missing.vmt");
    expect(() =>
      editVmt({ path, edits: [{ path: ["Proxies", "Nope", "x"], value: "1" }] }),
    ).toThrow(/no block "Nope"/);
    expect(() =>
      editVmt({ path, edits: [{ path: ["$missing"], value: "1" }] }),
    ).toThrow(/no "\$missing"/);
    expect(readFileSync(path, "utf8")).toBe(WALL);
  });

  it("refuses a duplicate key instead of choosing which one the engine keeps", () => {
    const path = material(
      "edit-duplicate.vmt",
      '"VertexLitGeneric"\n{\n\t"$basetexture" "a"\n\t"$basetexture" "b"\n}\n',
    );
    expect(() =>
      editVmt({ path, edits: [{ path: ["$basetexture"], value: "c" }] }),
    ).toThrow(/appears 2 times/);
  });

  it("writes a dry run nowhere, an add-on copy elsewhere, and closes a repaired file", () => {
    const path = material("edit-dry.vmt");
    const dry = editVmt({
      path,
      edits: [{ path: ["$basetexture"], value: "dry" }],
      dryRun: true,
    }) as { written: boolean; backupPath: string | null };
    expect(dry.written).toBe(false);
    expect(dry.backupPath).toBeNull();
    expect(readFileSync(path, "utf8")).toBe(WALL);

    const out = join(scratch, "edit-copy.vmt");
    const copied = editVmt({
      path,
      out,
      edits: [{ path: ["$basetexture"], value: "copy" }],
    }) as { out: string; written: boolean };
    expect(copied.written).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(WALL);
    expect(readFileSync(copied.out, "utf8")).toContain('"$basetexture" "copy"');

    const broken = material(
      "edit-broken.vmt",
      '"UnlitGeneric"\n{\n\t"$basetexture" "vgui/white"\n\t"Proxies"\n\t{\n\t\t"AnimatedTexture"\n\t\t{\n\t\t\t"animatedtexturevar" "$basetexture"\n',
    );
    void editVmt({ path: broken, edits: [{ path: ["$basetexture"], value: "vgui/black" }] });
    const closed = readFileSync(broken, "utf8");
    expect(closed.trimEnd().endsWith("}")).toBe(true);
    expect(parseVmt(closed).appendedBraces).toBe(0);
    expect(parseVmt(closed).parameters.get("$basetexture")).toBe("vgui/black");
  });
});

describe("check_vmt patch resolution", () => {
  function materials(name: string): string {
    const root = join(scratch, name, "materials");
    mkdirSync(join(root, "concrete"), { recursive: true });
    writeFileSync(
      join(root, "concrete", "base.vmt"),
      '"LightmappedGeneric"\n{\n\t"$basetexture" "concrete/base"\n\t"$surfaceprop" "concrete"\n}\n',
      "utf8",
    );
    return root;
  }

  it("resolves a patch include under materialsDirs and reports its base", () => {
    const root = materials("patch-ok");
    const path = join(root, "concrete", "reskin.vmt");
    writeFileSync(
      path,
      '"patch"\n{\n\t"include" "materials/concrete/base.vmt"\n\t"replace"\n\t{\n\t\t"$basetexture" "concrete/new"\n\t}\n}\n',
      "utf8",
    );
    const r = checkVmtTool.handler({ path, materialsDirs: [root] }, ctx) as {
      overall: string;
      patch: {
        include: string;
        resolved: string | null;
        exists: boolean | null;
        shader: string | null;
        baseTexture: string | null;
        chain: string[];
        effectiveTextures: Array<{ key: string; texture: string }>;
      } | null;
      findings: Array<{ rule: string }>;
    };
    expect(r.patch).toMatchObject({
      include: "materials/concrete/base.vmt",
      exists: true,
      shader: "LightmappedGeneric",
      baseTexture: "concrete/new",
    });
    expect(r.patch!.resolved).toBe(join(root, "concrete", "base.vmt"));
    expect(r.overall).toBe("pass");
    expect(r.findings.map((finding) => finding.rule)).not.toContain("vmt-patch-missing");
  });

  it("applies a patch chain and reports the effective material", () => {
    const root = materials("patch-chain");
    const middle = join(root, "concrete", "middle.vmt");
    const outer = join(root, "concrete", "outer.vmt");
    writeFileSync(
      middle,
      '"patch"\n{\n\t"include" "materials/concrete/base.vmt"\n\t"replace"\n\t{\n\t\t"$surfaceprop" "metal"\n\t}\n}\n',
      "utf8",
    );
    writeFileSync(
      outer,
      '"patch"\n{\n\t"include" "materials/concrete/middle.vmt"\n\t"replace"\n\t{\n\t\t"$basetexture" "concrete/outer"\n\t}\n}\n',
      "utf8",
    );
    const r = checkVmtTool.handler({ path: outer, materialsDirs: [root] }, ctx) as {
      overall: string;
      patch: {
        shader: string | null;
        baseTexture: string | null;
        chain: string[];
        effectiveTextures: Array<{ key: string; texture: string }>;
        note: string;
      } | null;
    };
    expect(r.patch?.shader).toBe("LightmappedGeneric");
    expect(r.patch?.baseTexture).toBe("concrete/outer");
    expect(r.patch?.chain).toEqual([
      join(root, "concrete", "middle.vmt"),
      join(root, "concrete", "base.vmt"),
    ]);
    expect(r.patch?.effectiveTextures).toContainEqual({
      key: "$basetexture",
      texture: "concrete/outer",
    });
    expect(r.patch?.note).toMatch(/2 link/);
    expect(r.overall).toBe("pass");
  });

  it("names a missing include and a patch with no roots to search", () => {
    const root = materials("patch-missing");
    const path = join(root, "concrete", "broken.vmt");
    writeFileSync(
      path,
      '"patch"\n{\n\t"include" "materials/concrete/not-here.vmt"\n\t"replace"\n\t{\n\t}\n}\n',
      "utf8",
    );
    const missing = checkVmtTool.handler({ path, materialsDirs: [root] }, ctx) as {
      overall: string;
      patch: { exists: boolean | null; note: string } | null;
      findings: Array<{ rule: string }>;
    };
    expect(missing.patch?.exists).toBe(false);
    expect(missing.patch?.note).toMatch(/not found/);
    expect(missing.overall).toBe("warn");
    expect(missing.findings.map((finding) => finding.rule)).toContain("vmt-patch-missing");

    const unresolved = checkVmtTool.handler({ path, materialsDirs: [] }, ctx) as {
      patch: { exists: boolean | null; note: string } | null;
      findings: Array<{ rule: string }>;
    };
    expect(unresolved.patch?.exists).toBeNull();
    expect(unresolved.patch?.note).toMatch(/materialsDirs/);
    expect(unresolved.findings.map((finding) => finding.rule)).toContain("vmt-patch-unresolved");
  });
});
