/**
 * The mode contract, against the real test campaign.
 *
 * The checks are deliberately the ones that are facts about the map: a scavenge map without
 * gas cans cannot score, a survival map without a finale trigger has nothing to start the
 * round, and a coop campaign whose last map has neither a finale nor a changelevel has no
 * ending. A map that exists only in a VPK is skipped with information, never passed.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { checkModesTool } from "../../src/campaigns/typescript/tools/modes.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-modes-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const MISSION = "campaigns/001-hsmcp-test/addon/missions/hsmcp_campaign.txt";
const MAPS = "campaigns/001-hsmcp-test/addon/maps";

type Result = {
  overall: string;
  findings: Array<{ severity: string; rule: string; mode: string; map: string | null }>;
  modes: Array<{ name: string; chapters: number; known: boolean }>;
};

describe("check_modes", () => {
  it("passes the scavenge items and warns that survival has no trigger", async () => {
    const result = (await checkModesTool.handler(
      { path: MISSION, mapsDirs: [MAPS] },
      ctx,
    )) as Result;
    const rules = result.findings.map((finding) => finding.rule);
    expect(rules).toContain("mode-scavenge-items");
    expect(rules).not.toContain("mode-scavenge-no-items");
    expect(rules).toContain("mode-survival-no-trigger");
    expect(rules).not.toContain("mode-last-no-end");
    expect(result.overall).toBe("warn");
    expect(result.modes.map((mode) => mode.name)).toEqual([
      "coop",
      "survival",
      "scavenge",
      "versus",
    ]);
  });

  it("warns about a mode name the menu cannot show", async () => {
    const mission = join(scratch, "unknown-mode.txt");
    writeFileSync(
      mission,
      [
        '"mission"',
        "{",
        '\t"Name" "UnknownMode"',
        '\t"modes"',
        "\t{",
        '\t\t"versus2"',
        "\t\t{",
        '\t\t\t"1" { "Map" "hsmcp_test_m1" }',
        "\t\t}",
        "\t}",
        "}",
      ].join("\n"),
    );
    const result = (await checkModesTool.handler(
      { path: mission, mapsDirs: [MAPS] },
      ctx,
    )) as Result;
    expect(result.findings.map((finding) => finding.rule)).toContain("mode-unknown-name");
    expect(result.modes[0]).toMatchObject({ name: "versus2", known: false });
  });

  it("reports a map repeated inside one mode", async () => {
    const mission = join(scratch, "duplicate.txt");
    writeFileSync(
      mission,
      [
        '"mission"',
        "{",
        '\t"Name" "Duplicate"',
        '\t"modes"',
        "\t{",
        '\t\t"coop"',
        "\t\t{",
        '\t\t\t"1" { "Map" "hsmcp_test_m1" }',
        '\t\t\t"2" { "Map" "hsmcp_test_m1" }',
        "\t\t}",
        "\t}",
        "}",
      ].join("\n"),
    );
    const result = (await checkModesTool.handler(
      { path: mission, mapsDirs: [MAPS] },
      ctx,
    )) as Result;
    expect(result.findings.map((finding) => finding.rule)).toContain("mode-duplicate-map");
  });
});
