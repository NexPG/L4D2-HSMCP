import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Agent Skills specification, enforced instead of remembered.
 *
 * The skill is installed by directory name, but clients read the YAML frontmatter to
 * discover it. A name that is uppercase, too long or different from the directory makes
 * the skill invisible even though every page is present. The body limit keeps the
 * progressive-disclosure contract: SKILL.md is the router, references hold the detail.
 */
const ROOT = join(import.meta.dirname, "..", "..");
const SKILL_ROOT = join(ROOT, "skill", "l4d2-hsmcp");
const SKILL = join(SKILL_ROOT, "SKILL.md");

function frontmatter(source: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!match) throw new Error("SKILL.md has no YAML frontmatter");
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (field) fields[field[1]!] = field[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

describe("Agent Skills specification", () => {
  const source = readFileSync(SKILL, "utf8");
  const fields = frontmatter(source);
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const directory = basename(SKILL_ROOT);

  it("has a valid name that matches the directory", () => {
    expect(fields.name, "name is required").toBeTruthy();
    expect(fields.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(fields.name!.length).toBeLessThanOrEqual(64);
    expect(fields.name).toBe(directory);
    expect(fields.name).not.toMatch(/anthropic|claude/i);
  });

  it("has a description that says what and when, within the limit", () => {
    expect(fields.description, "description is required").toBeTruthy();
    expect(fields.description!.length).toBeGreaterThan(0);
    expect(fields.description!.length).toBeLessThanOrEqual(1024);
    expect(fields.description).not.toMatch(/<[A-Za-z/]/);
    expect(fields.description).toMatch(/\bUse (for|when)\b/i);
  });

  it("keeps optional fields inside their limits", () => {
    if (fields.compatibility !== undefined) {
      expect(fields.compatibility.length).toBeLessThanOrEqual(500);
    }
  });

  it("keeps the body under 500 lines", () => {
    expect(body.split("\n").length).toBeLessThan(500);
  });

  it("is the only SKILL.md at the skill root", () => {
    expect(statSync(SKILL).isFile()).toBe(true);
    expect(dirname(SKILL)).toBe(SKILL_ROOT);
  });
});
