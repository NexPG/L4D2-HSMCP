/**
 * The skill, exposed through MCP resources.
 *
 * A client that has only the server (no separate skill installation) should still be able
 * to read the same guidance: what "correct" looks like in L4D2, which workflow to follow,
 * and what is genuinely unsupported. The files under `skill/l4d2-hsmcp` are the source;
 * this module lists them and serves them as `l4d2-hsmcp://skill/<path>` resources.
 *
 * It is a reader, not a second copy: no text is embedded here.
 */
import { readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SKILL_URI_PREFIX = "l4d2-hsmcp://skill/";

export interface SkillFile {
  /** POSIX-style path relative to the skill root, e.g. `references/tools/index.md`. */
  path: string;
  uri: string;
  title: string;
}

/** Every Markdown file under the skill root, sorted, with a stable URI. */
export function listSkillFiles(root: string): SkillFile[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.toLowerCase().endsWith(".md")) {
        files.push(relative(root, path).split(sep).join("/"));
      }
    }
  };
  walk(root);
  files.sort();
  return files.map((path) => ({
    path,
    uri: `${SKILL_URI_PREFIX}${path}`,
    title: path.replace(/\.md$/i, ""),
  }));
}

/**
 * Reads one skill file, refusing a path that escapes the skill root.
 *
 * The resource URI is part of the MCP surface, so it is caller-controlled. `resolve` plus
 * a `relative` check is the same discipline the VPK extractor uses: never hand a name from
 * outside to `readFileSync` without proving it stays under the root.
 */
export function readSkillFile(root: string, path: string): string {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error(`${path} is outside the skill root`);
  }
  return readFileSync(absolute, "utf8");
}

/** Registers every skill file as a resource. Returns how many were registered. */
export function registerSkillResources(server: McpServer, root: string): number {
  const files = listSkillFiles(root);
  for (const file of files) {
    server.registerResource(
      `skill-${file.path.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")}`,
      file.uri,
      {
        title: `L4D2-HSMCP: ${file.title}`,
        description: `The L4D2-HSMCP skill page ${file.path}`,
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.toString(),
            mimeType: "text/markdown",
            text: readSkillFile(root, file.path),
          },
        ],
      }),
    );
  }
  return files.length;
}
