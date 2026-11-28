import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The layout rules, enforced instead of remembered.
 *
 * The owner's rule is that the whole project is filed into logical directories: a flat
 * pile of files in one folder is a structural defect, a test lives beside the module it
 * drives, and every directory explains itself. These checks are cheap and they fail the
 * build when the shape drifts back.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const TEST = join(ROOT, "test");
const DOCS = join(ROOT, "docs");
const SKILL = join(ROOT, "skill");

/**
 * Every tracked file allowed at the repository root, and nothing else.
 *
 * The root had accrued a pile of one-off files once already. A whitelist is blunt on
 * purpose: adding a root file is a decision, and the decision is this table plus the one in
 * CONTRIBUTING.md. Generated and machine-specific files are ignored by `.gitignore`, not
 * listed here because they are not tracked.
 */
const ROOT_FILES = new Set([
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "config.example.json",
  "eslint.config.js",
  "opencode.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.test.json",
  "vitest.config.ts",
]);

function entries(dir: string): string[] {
  return readdirSync(dir).sort();
}

/** Every directory below `dir`, including `dir` itself. */
function directories(dir: string): string[] {
  const out = [dir];
  for (const name of entries(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...directories(path));
  }
  return out;
}

/** Every file below `dir` with one of the given extensions. */
function files(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const name of entries(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...files(path, extensions));
    } else if (extensions.some((ext) => name.endsWith(ext))) {
      out.push(path);
    }
  }
  return out;
}

describe("test layout", () => {
  it("keeps the repository root to the documented files", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split(/\r?\n/)
      .filter((file) => file.length > 0 && !file.includes("/"));
    const unexpected = tracked.filter((file) => !ROOT_FILES.has(file));
    const missing = [...ROOT_FILES].filter((file) => !tracked.includes(file));
    expect(unexpected, `root files with no documented job: ${unexpected.join(", ")}`).toEqual([]);
    expect(missing, `documented root files that are not tracked: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps the test root free of loose suites", () => {
    const loose = entries(TEST).filter((f) => f.endsWith(".test.ts"));
    expect(loose, "a .test.ts at the test root belongs in the directory it mirrors").toEqual([]);
  });

  it("gives every test directory a suite or a stated support role", () => {
    const supportOnly = new Set(["support", "fixtures"]);
    for (const name of entries(TEST)) {
      const path = join(TEST, name);
      if (!statSync(path).isDirectory()) continue;
      if (supportOnly.has(name)) continue;
      const suites = files(path, [".test.ts"]);
      expect(suites.length, `test/${name}/ has no suite`).toBeGreaterThan(0);
    }
  });

  it("lists every test directory in test/README.md", () => {
    const readme = readFileSync(join(TEST, "README.md"), "utf8");
    for (const name of entries(TEST)) {
      if (!statSync(join(TEST, name)).isDirectory()) continue;
      expect(readme, `test/README.md does not mention ${name}/`).toContain(`${name}/`);
    }
  });
});

describe("documentation layout", () => {
  it("keeps docs/ nested instead of one flat pile", () => {
    const loose = entries(DOCS).filter((name) => statSync(join(DOCS, name)).isFile());
    expect(loose).toEqual(["README.md"]);
  });

  it("gives every docs directory an index", () => {
    for (const dir of directories(DOCS).slice(1)) {
      expect(existsSync(join(dir, "README.md")), `${dir} has no README.md`).toBe(true);
    }
  });

  it("lists every skill page in SKILL.md", () => {
    const skillRoot = join(SKILL, "l4d2-hsmcp");
    const router = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
    const orphans = files(skillRoot, [".md"])
      .filter((file) => !file.endsWith("SKILL.md"))
      .map((file) => file.slice(skillRoot.length + 1).replaceAll("\\", "/"))
      .filter((rel) => !router.includes(rel) && !router.includes(rel.split("/").pop()!));
    expect(orphans, `skill pages not routed from SKILL.md: ${orphans.join(", ")}`).toEqual([]);
  });

  it("keeps every Contents bullet pointing at a section on the page", () => {
    // A page over 100 lines starts with Contents, and a bullet that names no heading is a
    // dead route: the reader sees a section in the table that does not exist. This caught
    // the tool catalogue missing its Steam Workshop group and the publish workflow missing
    // its credits/fork rules.
    const normalize = (text: string): string =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const failures: string[] = [];
    for (const file of files(join(SKILL, "l4d2-hsmcp"), [".md"])) {
      const text = readFileSync(file, "utf8");
      const start = text.indexOf("## Contents");
      if (start < 0) continue;
      const after = text.slice(start + "## Contents".length);
      const next = after.search(/^## /m);
      const block = next < 0 ? after : after.slice(0, next);
      const headings = new Set(
        [...text.matchAll(/^## (.+)$/gm)].map((match) => normalize(match[1]!)),
      );
      for (const bullet of block.matchAll(/^- (.+)$/gm)) {
        const label = normalize(bullet[1]!);
        if (!headings.has(label)) {
          failures.push(`${file.slice(SKILL.length + 1)}: "${bullet[1]}"`);
        }
      }
    }
    expect(failures, `Contents bullets with no section:\n${failures.join("\n")}`).toEqual([]);
  });

  it("has no broken relative links", () => {
    const roots = [join(ROOT, "README.md"), ...files(DOCS, [".md"]), ...files(SKILL, [".md"])];
    const broken: string[] = [];
    for (const file of roots) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1]!;
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const withoutAnchor = target.split("#")[0]!;
        if (!withoutAnchor) continue;
        const decoded = decodeURIComponent(withoutAnchor);
        const path = resolve(dirname(file), decoded);
        if (!existsSync(path)) {
          broken.push(`${file.slice(ROOT.length + 1)} -> ${target}`);
        }
      }
    }
    expect(broken, `broken links:\n${broken.join("\n")}`).toEqual([]);
  });
});
