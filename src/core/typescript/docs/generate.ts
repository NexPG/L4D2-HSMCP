/**
 * Writes `docs/tools/` from the registry.
 *
 * Run it with `pnpm docs:tools` after adding, renaming or re-describing a tool. The test
 * `test/tools/docs.test.ts` compares the generated text with the files, so a forgotten run
 * is a red test rather than a stale page.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildToolCatalog } from "./toolcatalog.js";

const root = process.cwd();
const outDir = join(root, "docs", "tools");
const catalog = buildToolCatalog(root);
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, "README.md"), catalog.readme, "utf8");
for (const [name, text] of Object.entries(catalog.files)) {
  writeFileSync(join(outDir, name), text, "utf8");
}

const expected = new Set(["README.md", ...Object.keys(catalog.files)]);
for (const name of readdirSync(outDir)) {
  if (name.endsWith(".md") && !expected.has(name)) {
    rmSync(join(outDir, name));
  }
}

console.log(`docs/tools: ${catalog.total} tools`);
for (const [sphere, count] of Object.entries(catalog.counts)) {
  console.log(`  ${sphere}: ${count}`);
}
