/**
 * The Hammer build registry: the data `hammer_status` identifies a build by.
 *
 * The file is upstream data (MIT, EpicMorg/Hammer-MCP) kept next to the C# reference it came
 * with. It is JSON with `//` comments and a trailing comma, and the sidecar reads it with the
 * same clean-up as below — so this test is also the specification for that clean-up. The
 * assertion that matters is the count and the shape: a truncated registry still parses as
 * JSON and would silently identify nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REGISTRY = join(import.meta.dirname, "..", "..", "src", "hammer", "data", "hammers.json");

interface Build {
  id: string;
  family: string;
  branch: string;
  build: number;
  arch: string;
  match: { dll: string; sha256: string };
  shell?: { present?: boolean };
}

function load(): Build[] {
  const text = readFileSync(REGISTRY, "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  return (JSON.parse(text) as { builds: Build[] }).builds;
}

describe("hammer build registry", () => {
  it("parses, and every entry can be identified by a DLL hash", () => {
    const builds = load();
    expect(builds.length).toBeGreaterThan(100);
    for (const build of builds) {
      expect(build.id, JSON.stringify(build)).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
      expect(build.match.dll).toMatch(/\.(dll|exe)$/i);
      expect(build.match.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // Duplicate hashes would make identification depend on file order.
    const hashes = builds.map((b) => b.match.sha256);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("knows the L4D2 branch, which is the one this project targets", () => {
    const builds = load().filter((b) => b.branch === "l4d2");
    expect(builds.length).toBeGreaterThan(0);
    expect(builds.some((b) => b.family === "hammerplusplus" && b.build >= 8867)).toBe(true);
  });
});
