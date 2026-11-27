/**
 * Make the L4D2 skill discoverable from any directory inside the repository.
 *
 * OpenCode finds project skills in `.opencode/skills` while walking up from the working
 * directory, but the `skills` entry in `opencode.json` resolves relative to that working
 * directory. A session started in `src/` or `workspaces/<project>/` therefore saw the
 * config entry and still failed with "Unable to load skill l4d2-hsmcp".
 *
 * The canonical files stay in `skill/l4d2-hsmcp` (that directory is what the npm package
 * ships and what the MCP server serves). This script points `.opencode/skills/l4d2-hsmcp`
 * at it with a directory link, so there is still one copy of the content.
 *
 * Idempotent: a correct link is left alone; an existing real directory is reported and
 * never deleted.
 */
import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "skill", "l4d2-hsmcp");
const skillsDir = join(root, ".opencode", "skills");
const link = join(skillsDir, "l4d2-hsmcp");

if (!existsSync(join(target, "SKILL.md"))) {
  console.error(`link-skill: ${target} does not contain SKILL.md`);
  process.exit(1);
}

mkdirSync(skillsDir, { recursive: true });

let existing;
try {
  existing = lstatSync(link);
} catch {
  existing = undefined;
}

if (existing) {
  if (existing.isSymbolicLink()) {
    if (existsSync(link) && realpathSync(link) === realpathSync(target)) {
      console.log("link-skill: .opencode/skills/l4d2-hsmcp already points at skill/l4d2-hsmcp");
      process.exit(0);
    }
    console.error(
      `link-skill: .opencode/skills/l4d2-hsmcp is a link to another directory; remove it first`,
    );
    process.exit(1);
  }
  console.error(
    "link-skill: .opencode/skills/l4d2-hsmcp exists and is not a link; " +
      "delete it so the real skill in skill/l4d2-hsmcp stays the only copy",
  );
  process.exit(1);
}

symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
console.log("link-skill: .opencode/skills/l4d2-hsmcp -> skill/l4d2-hsmcp");
