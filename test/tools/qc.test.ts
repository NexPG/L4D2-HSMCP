/**
 * QC: the source a model is compiled from.
 *
 * The grammar is `scriplib`'s, and three of its details are the ones a naive reader gets
 * wrong: a backslash is a literal (so `"models\weapons\"` is a valid argument that does not
 * escape its closing quote), `//` starts a comment wherever it appears outside a string, and
 * `$include` nests to a fixed depth and can point at itself. The tests below pin those, plus
 * the structural checks whose absence stops `studiomdl`: no `$modelname`, no `$body`, a
 * sequence declared twice.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildQc,
  flattenQc,
  lexQc,
  loadQc,
  parseQc,
  qcModelName,
  qcSequences,
  walkQc,
} from "../../src/formats/typescript/formats/qc.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readQcTool, writeQcTool } from "../../src/models/typescript/tools/qc.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-qc-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const VIEWMODEL = `// a viewmodel
$modelname "models/weapons/v_test.mdl"
$body "Body" "v_test_ref.smd"
$cdmaterials "models\\\\weapons\\\\v_test\\\\" "models\\\\weapons\\\\shared\\\\"
$surfaceprop "metal"
$attachment "muzzle" "ValveBiped.Bip01_R_Hand" 0 0 0 rotate 0 0 0

$sequence "idle" "v_test_idle.smd" fps 30 activity ACT_VM_IDLE 1 {
	event 5001 0 "40" "357"
	node "muzzle"
}
$sequence "fire" {
	"v_test_fire.smd"
	fps 30
	activity ACT_VM_PRIMARYATTACK 1
}
$sequence "idle" "v_test_idle2.smd"
`;

describe("qc format", () => {
  it("lexes a literal backslash, comments and braces", () => {
    // String.raw: the point of the test is that a backslash is not an escape, so writing the
    // input through one would test the wrong thing.
    const source = String.raw`$cdmaterials "models\weapons\v_test\" // trailing
$body a "b.smd"
`;
    const tokens = lexQc(source);
    expect(tokens.map((t) => t.text)).toEqual([
      "$cdmaterials",
      "models\\weapons\\v_test\\",
      "$body",
      "a",
      "b.smd",
    ]);
    expect(tokens[1]!.quoted).toBe(true);
    expect(tokens[0]!.quoted).toBe(false);
  });

  it("groups a command's arguments onto its own line and a block beneath it", () => {
    const file = parseQc(VIEWMODEL, "v_test.qc");
    const sequence = file.statements.find((s) => s.command === "$sequence");
    expect(sequence?.args).toEqual(["idle", "v_test_idle.smd", "fps", "30", "activity", "ACT_VM_IDLE", "1"]);
    expect(sequence?.block?.map((s) => s.command)).toEqual(["event", "node"]);

    // The block form is a command with no arguments followed by a block of its own.
    const fire = file.statements.filter((s) => s.command === "$sequence")[1]!;
    expect(fire.block?.map((s) => s.command)).toEqual(["v_test_fire.smd", "fps", "activity"]);
  });

  it("reads sequences as data, including activity weight", () => {
    const sequences = qcSequences(parseQc(VIEWMODEL));
    expect(sequences.map((s) => s.name)).toEqual(["idle", "fire", "idle"]);
    expect(sequences[0]).toMatchObject({
      smd: "v_test_idle.smd",
      fps: 30,
      activity: "ACT_VM_IDLE",
      activities: [{ name: "ACT_VM_IDLE", weight: 1 }],
    });
    expect(sequences[1]!.smd).toBeNull();
    expect(sequences[1]!.fps).toBeNull();
  });

  it("reports the faults that stop a compile", () => {
    const file = parseQc('$cdmaterials "x"\n$sequence "idle" "a.smd"\n$sequence "idle" "b.smd"\n');
    const rules = file.diagnostics.map((d) => d.rule);
    expect(rules).toContain("qc-no-modelname");
    expect(rules).toContain("qc-no-body");
    expect(rules).toContain("qc-duplicate-sequence");
    expect(rules).not.toContain("qc-no-cdmaterials");
  });

  it("warns about a model path the engine will not load", () => {
    const file = parseQc('$modelname "props/thing"\n$body "b" "a.smd"\n');
    const rules = file.diagnostics.map((d) => d.rule);
    expect(rules).toContain("qc-modelname-outside-models");
    expect(rules).toContain("qc-modelname-without-mdl");
  });

  it("expands $definemacro bodies, including the \\\\ continuation", () => {
    const source = String.raw`$definemacro Wrap A \\
$body $A$ x \\
$tail
$modelname "models/a.mdl"
$Wrap val
`;
    const file = parseQc(source);
    const body = file.statements.find((s) => s.command === "$body");
    expect(body?.args).toEqual(["val", "x", "$tail"]);
    expect(file.statements.map((s) => s.command)).not.toContain("$definemacro");
  });

  it("substitutes macro parameters inside quoted arguments too", () => {
    const source = String.raw`$definemacro Att Name Bone \\
$attachment "$Name$" "$Bone$"
$modelname "models/a.mdl"
$body "b" "a.smd"
$Att "muzzle" "ValveBiped.Bip01_R_Hand"
`;
    const file = parseQc(source);
    const attachment = file.statements.find((s) => s.command === "$attachment")!;
    expect(attachment.args).toEqual(["muzzle", "ValveBiped.Bip01_R_Hand"]);
  });

  it("carries a macro across $include and stops a self-recursive one", () => {
    const dir = join(scratch, "macros");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "defs.qci"),
      String.raw`$definemacro MakeBody Name \\
$body "$Name$" "$Name$.smd"
`,
    );
    writeFileSync(
      join(dir, "main.qc"),
      '$include "defs.qci"\n$modelname "models/a.mdl"\n$MakeBody Crate\n',
    );
    const file = loadQc(join(dir, "main.qc"));
    const body = flattenQc(file)
      .flatMap((f) => walkQc(f.statements))
      .find((s) => s.command === "$body")!;
    expect(body.args).toEqual(["Crate", "Crate.smd"]);

    const recursive = parseQc(
      String.raw`$definemacro Loop \\
$Loop
$Loop
`,
    );
    expect(recursive.diagnostics.map((d) => d.rule)).toContain("qc-macro-recursion");
  });

  it("expands $definevariable only in bare tokens, with the first definition winning", () => {
    const file = parseQc(
      [
        '$definevariable Bone "ValveBiped.Bip01_"',
        '$definevariable Name first',
        '$definevariable Name second',
        '$modelname "models/$Name$.mdl"',
        '$body "b" x.smd',
        '$attachment "quoted" "$Bone$Hand"',
        '$attachment "bare" $Bone$Hand',
        '$attachment "embedded" $Bone$Pelvis',
      ].join("\n"),
    );
    const attachments = file.statements.filter((s) => s.command === "$attachment");
    // Quoted strings are not expanded; `$Bone$Hand` stays literal.
    expect(attachments[0]!.args[1]).toBe("$Bone$Hand");
    expect(attachments[1]!.args[1]).toBe("ValveBiped.Bip01_Hand");
    expect(attachments[2]!.args[1]).toBe("ValveBiped.Bip01_Pelvis");
    expect(file.diagnostics.map((d) => d.rule)).toContain("qc-variable-redefined");
    // A quoted model name keeps the literal too; the writer's arg is not a bare token.
    expect(file.statements.find((s) => s.command === "$modelname")!.args[0]).toBe(
      "models/$Name$.mdl",
    );
  });

  it("reports an undefined variable instead of silently leaving it for studiomdl", () => {
    const file = parseQc('$modelname "models/a.mdl"\n$body "b" $Nope$.smd\n');
    expect(file.diagnostics.map((d) => d.rule)).toContain("qc-unknown-variable");
    expect(file.statements.find((s) => s.command === "$body")!.args[1]).toBe("$Nope$.smd");
  });

  it("carries variables across $include, which is where a real QC uses them", () => {
    const dir = join(scratch, "variables");
    mkdirSync(join(dir, "parts"), { recursive: true });
    writeFileSync(
      join(dir, "main.qc"),
      '$definevariable Name body\n$modelname "models/a.mdl"\n$include "parts/body.qci"\n',
    );
    writeFileSync(join(dir, "parts", "body.qci"), '$body "Body" $Name$.smd\n');
    const file = loadQc(join(dir, "main.qc"));
    const body = flattenQc(file)
      .flatMap((f) => walkQc(f.statements))
      .find((s) => s.command === "$body")!;
    expect(body.args[1]).toBe("body.smd");
  });

  it("resolves $include through $pushd/$popd/$cd, as scriplib's qdir does", () => {
    const dir = join(scratch, "qdir");
    mkdirSync(join(dir, "parts"), { recursive: true });
    writeFileSync(join(dir, "parts", "body.qci"), '$body "Body" "body.smd"\n');
    writeFileSync(join(dir, "other.qci"), '$cdmaterials "models/x/"\n');
    writeFileSync(
      join(dir, "main.qc"),
      [
        '$modelname "models/a.mdl"',
        '$pushd "parts"',
        '$include "body.qci"',
        '$popd',
        '$cd "parts"',
        '$include "body.qci"',
        '$cd ".."',
        '$include "other.qci"',
        "",
      ].join("\n"),
    );
    const file = loadQc(join(dir, "main.qc"));
    const names = file.includes.map((p) => p.replace(/\\/g, "/").split("/").pop());
    expect(names).toEqual(["body.qci", "body.qci", "other.qci"]);
    expect(file.diagnostics.map((d) => d.rule)).not.toContain("qc-include-missing");
  });

  it("follows includes, reports a missing one, and refuses to loop", () => {
    const dir = join(scratch, "includes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "main.qc"), '$modelname "models/a.mdl"\n$include "parts/body.qci"\n$include "gone.qci"\n');
    mkdirSync(join(dir, "parts"), { recursive: true });
    writeFileSync(join(dir, "parts", "body.qci"), '$body "Body" "body.smd"\n');
    writeFileSync(join(dir, "parts", "cycle.qci"), '$include "cycle.qci"\n');

    const file = loadQc(join(dir, "main.qc"));
    expect(file.includes.map((p) => p.replace(/\\/g, "/").split("/").pop())).toEqual(["body.qci"]);
    expect(flattenQc(file).length).toBe(2);
    const rules = file.diagnostics.map((d) => d.rule);
    expect(rules).toContain("qc-include-missing");

    const cycled = loadQc(join(dir, "parts", "cycle.qci"));
    expect(cycled.diagnostics.map((d) => d.rule)).toContain("qc-include-cycle");
  });

  it("stops at the include depth limit instead of recursing forever", () => {
    const dir = join(scratch, "deep");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.qc"), '$include "b.qci"\n');
    writeFileSync(join(dir, "b.qci"), '$include "c.qci"\n');
    writeFileSync(join(dir, "c.qci"), "$body b x.smd\n");
    const file = loadQc(join(dir, "a.qc"), { maxDepth: 1 });
    // The diagnostic belongs to the file whose include was refused, not to the root.
    expect(flattenQc(file).flatMap((f) => f.diagnostics).map((d) => d.rule)).toContain(
      "qc-include-too-deep",
    );
  });

  it("builds a QC that its own parser accepts", () => {
    const text = buildQc({
      modelname: "models/props_myaddon/crate.mdl",
      body: [{ name: "Body", smd: "crate_ref.smd" }],
      cdmaterials: ["models/props_myaddon"],
      surfaceprop: "wood",
      staticprop: true,
      sequences: [{ name: "idle", smd: "crate_idle.smd", fps: 30 }],
      attachments: [{ name: "attach", bone: "root", position: [0, 0, 64] }],
      extra: ["$keyvalues { prop_data { base \"Wooden.Medium\" } }"],
    });
    expect(text).toContain('$modelname "models/props_myaddon/crate.mdl"');
    expect(text).toContain("$staticprop");
    expect(text).toContain("$attachment");

    const parsed = parseQc(text, "crate.qc");
    expect(qcModelName(parsed)).toBe("models/props_myaddon/crate.mdl");
    expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(walkQc(parsed.statements).map((s) => s.command)).toContain("$surfaceprop");
  });

  it("refuses to build a QC that cannot compile", () => {
    expect(() => buildQc({ modelname: "" })).toThrow(/needs a \$modelname/);
    expect(() => buildQc({ modelname: "models/a.mdl", body: [] })).toThrow(/no geometry/);
    expect(() => buildQc({ modelname: 'models/a".mdl' })).toThrow(/cannot contain a quote/);
  });
});

describe("qc tools", () => {
  it("writes a QC, reads it back and reports no errors", async () => {
    const path = join(scratch, "models", "props_test", "crate.qc");
    const written = (await writeQcTool.handler(
      {
        path,
        modelname: "models/props_test/crate.mdl",
        body: [{ name: "Body", smd: "crate_ref.smd" }],
        cdmaterials: ["models/props_test"],
        surfaceprop: "wood",
        staticprop: true,
        sequences: [{ name: "idle", smd: "crate_idle.smd", fps: 30 }],
        attachments: [{ name: "attach", bone: "root" }],
        overwrite: false,
        confirm: true,
      },
      ctx,
    )) as { written: boolean; modelName: string; diagnostics: Array<{ severity: string }> };

    expect(written.written).toBe(true);
    expect(written.modelName).toBe("models/props_test/crate.mdl");
    expect(written.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(existsSync(path)).toBe(true);

    const read = (await readQcTool.handler({ path }, ctx)) as {
      modelName: string | null;
      sequences: Array<{ name: string; fps: number | null }>;
      materials: string[];
      ok: boolean;
      includeCount: number;
    };
    expect(read.modelName).toBe("models/props_test/crate.mdl");
    expect(read.sequences.map((s) => [s.name, s.fps])).toEqual([["idle", 30]]);
    expect(read.materials).toEqual(["models/props_test"]);
    expect(read.includeCount).toBe(0);
    expect(read.ok).toBe(true);

    expect(() =>
      writeQcTool.handler(
        { path, modelname: "models/props_test/other.mdl", staticprop: false, overwrite: false, confirm: true },
        ctx,
      ),
    ).toThrow(/already exists/);
  });

  it("reads a QC that is structurally broken without throwing", async () => {
    const path = join(scratch, "broken.qc");
    writeFileSync(path, '$surfaceprop "metal"\n');
    const read = (await readQcTool.handler({ path }, ctx)) as {
      ok: boolean;
      diagnostics: Array<{ rule: string; severity: string }>;
    };
    expect(read.ok).toBe(false);
    expect(read.diagnostics.map((d) => d.rule)).toContain("qc-no-modelname");
    expect(readFileSync(path, "utf8")).toBe('$surfaceprop "metal"\n');
  });
});
