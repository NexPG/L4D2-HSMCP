import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
