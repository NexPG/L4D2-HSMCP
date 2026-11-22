/**
 * The skill is served as MCP resources, so its file list and its reader are part of the
 * server surface. These tests pin the two failure modes: a resource that names a file the
 * package does not ship, and a URI that escapes the skill root.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SKILL_URI_PREFIX,
  listSkillFiles,
  readSkillFile,
} from "../../src/core/typescript/mcp/skill.js";
import { REPO } from "../support/env.js";

const SKILL = join(REPO, "skill", "l4d2-hsmcp");

describe("skill resources", () => {
  it("lists every shipped Markdown page with a stable URI", () => {
    const files = listSkillFiles(SKILL);
    expect(files.length).toBeGreaterThan(50);
    expect(files.map((file) => file.path)).toContain("SKILL.md");
    expect(files.map((file) => file.path)).toContain("references/tools/index.md");
    expect(files.every((file) => file.uri.startsWith(SKILL_URI_PREFIX))).toBe(true);
    expect(new Set(files.map((file) => file.uri)).size).toBe(files.length);
    for (const file of files) {
      expect(existsSync(join(SKILL, file.path)), file.path).toBe(true);
    }
  });

  it("reads the entry page and refuses a path outside the skill", () => {
    const text = readSkillFile(SKILL, "SKILL.md");
    expect(text.startsWith("---")).toBe(true);
    expect(text).toContain("# L4D2-HSMCP");
    expect(() => readSkillFile(SKILL, "../package.json")).toThrow(/outside the skill root/);
    expect(() => readSkillFile(SKILL, "..\\..\\package.json")).toThrow(/outside the skill root/);
    expect(() => readSkillFile(SKILL, "C:\\Windows\\win.ini")).toThrow(/outside the skill root/);
  });

  it("routes every workflow and every linked Markdown page to a real file", () => {
    const skill = readFileSync(join(SKILL, "SKILL.md"), "utf8");
    const workflows = readdirSync(join(SKILL, "workflows"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => `workflows/${name}`);
    for (const workflow of workflows) {
      expect(skill, `${workflow} is not mentioned in SKILL.md`).toContain(workflow);
    }

    const missing: string[] = [];
    for (const match of skill.matchAll(/`([^`\n]+\.md)`/g)) {
      const path = match[1]!;
      if (existsSync(join(SKILL, path)) || existsSync(join(REPO, path))) continue;
      missing.push(path);
    }
    expect(missing, "linked in SKILL.md and absent from the repository").toEqual([]);
  });
});
