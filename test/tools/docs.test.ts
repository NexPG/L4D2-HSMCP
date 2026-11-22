/**
 * `docs/tools/` is generated from the registry. This test is the reason it stays true:
 * adding, renaming or re-describing a tool without running `pnpm docs:tools` fails here
 * instead of leaving a catalogue that disagrees with the server.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTools } from "../../src/registry.js";
import { buildToolCatalog } from "../../src/core/typescript/docs/toolcatalog.js";
import { REPO } from "../support/env.js";

describe("docs/tools", () => {
  const catalog = buildToolCatalog(REPO);
  const dir = join(REPO, "docs", "tools");

  it("counts every registered tool exactly once", () => {
    expect(catalog.total).toBe(allTools.length);
    expect(Object.values(catalog.counts).reduce((sum, count) => sum + count, 0)).toBe(
      allTools.length,
    );
  });

  it("matches the generated README and every area page", () => {
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe(catalog.readme);
    for (const [name, text] of Object.entries(catalog.files)) {
      expect(readFileSync(join(dir, name), "utf8"), name).toBe(text);
    }
  });

  it("has no stale area pages", () => {
    const expected = new Set(["README.md", ...Object.keys(catalog.files)]);
    const actual = readdirSync(dir).filter((name) => name.endsWith(".md"));
    expect(actual.sort()).toEqual([...expected].sort());
  });
});
