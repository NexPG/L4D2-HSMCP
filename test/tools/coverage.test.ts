import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTools } from "../../src/registry.js";

/**
 * The documents that tell an agent what this server can do.
 *
 * Two kinds of drift are possible and both have happened: a table names a tool that was
 * renamed or removed, and a row says "gap" about a capability that now exists. The second
 * cannot be checked without understanding the prose, but the first can -- and it is the one
 * that makes an agent call something that is not there.
 *
 * The catalogue is also checked for the opposite: a registered tool that no reference file
 * mentions is a tool nobody can find.
 */

const SKILL = join(import.meta.dirname, "..", "..", "skill", "l4d2-hsmcp");
const COVERAGE = join(SKILL, "references", "mapping", "hammer-coverage.md");
const HAMMERPP = join(import.meta.dirname, "..", "..", "docs", "reference", "hammerpp-complete-reference.md");
const INDEX = join(SKILL, "references", "tools", "index.md");

const names = new Set(allTools.map((tool) => tool.name));

/**
 * Entity classnames that appear in a Tool column because that is where a mapper meets them.
 * They are not tools, and listing them here is cheaper than teaching the parser what an
 * entity is; a new one shows up as a test failure with its line number.
 */
const ENTITY_NAMES = new Set([
  "env_cubemap",
  "func_instance",
  "func_nav_attribute_region",
  "sky_camera",
]);

/** Backticked names that look like tools: at least one underscore and no path separator. */
function claimedTools(cell: string): string[] {
  const out: string[] = [];
  for (const match of cell.matchAll(/`([a-z][a-z0-9_]{3,})`/g)) {
    const name = match[1]!;
    if (!name.includes("_")) continue;
    if (name.includes("/")) continue;
    if (name.endsWith(".fgd") || name.endsWith(".exe")) continue;
    if (ENTITY_NAMES.has(name)) continue;
    out.push(name);
  }
  return out;
}

/**
 * Reads a Markdown table whose header names one of `columns`, and returns the names claimed
 * in that column. Only tables with the column are read: a "Beyond Hammer" table puts a tool
 * in column one and the console command it replaces in column two, so reading column two
 * there would collect console commands.
 */
function tableClaims(text: string, column: string): Array<{ name: string; line: number }> {
  const out: Array<{ name: string; line: number }> = [];
  let index: number | null = null;
  let lineNo = 0;
  for (const line of text.split("\n")) {
    lineNo += 1;
    if (!line.startsWith("|")) {
      index = null;
      continue;
    }
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] and the last are empty from the leading/trailing pipes.
    if (index === null) {
      const at = cells.findIndex((c) => c === column);
      if (at >= 0) index = at;
      continue;
    }
    if (cells.every((c) => /^-*$/.test(c))) continue;
    const cell = cells[index] ?? "";
    for (const name of claimedTools(cell)) out.push({ name, line: lineNo });
  }
  return out;
}

describe("the coverage documents name tools that exist", () => {
  it("hammer-coverage.md: every name in a Tool column is registered", () => {
    const text = readFileSync(COVERAGE, "utf8");
    const claims = tableClaims(text, "Tool");
    expect(claims.length, "the coverage table must claim some tools").toBeGreaterThan(40);

    const unknown = claims.filter((claim) => !names.has(claim.name));
    expect(
      unknown.map((u) => `${u.name} (line ${u.line})`),
      "claimed in a Tool column and not registered",
    ).toEqual([]);
  });

  it("hammerpp-complete-reference.md: every tool in its Tool/answer column is registered", () => {
    const text = readFileSync(HAMMERPP, "utf8");
    const claims = tableClaims(text, "Tool / answer");
    expect(claims.length).toBeGreaterThan(40);

    const unknown = claims.filter((claim) => !names.has(claim.name));
    expect(
      unknown.map((u) => `${u.name} (line ${u.line})`),
      "claimed in the Hammer++ reference and not registered",
    ).toEqual([]);
  });

  it("the tool catalogue states the number the registry has", () => {
    const text = readFileSync(INDEX, "utf8");
    const stated = text.match(/(\d+) tools\./);
    expect(stated, "the catalogue must state a tool count").not.toBeNull();
    expect(Number(stated![1])).toBe(allTools.length);
  });

  it("every registered tool is mentioned somewhere in the skill", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith(".md")) files.push(path);
      }
    };
    walk(SKILL);
    const text = files.map((file) => readFileSync(file, "utf8")).join("\n");

    const missing = [...names].filter((name) => !text.includes(name));
    expect(missing, "registered and absent from every skill reference").toEqual([]);
  });
});
