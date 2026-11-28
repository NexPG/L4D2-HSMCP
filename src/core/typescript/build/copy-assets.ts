/**
 * Copies the one non-TypeScript file a tool needs at runtime: the C# source of the legacy
 * Workshop upload helper. `tsc` emits only JavaScript, and the helper is compiled on the
 * user's machine by the .NET Framework `csc.exe` that ships with Windows, so the source
 * must travel with `dist/`. Run by `pnpm build` after `tsc`.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const relative = "packages/typescript/workshop/legacy/WorkshopLegacy.cs";
const source = join(root, "src", relative);
const target = join(root, "dist", relative);

if (!existsSync(source)) {
  throw new Error(`missing ${source}; nothing to copy`);
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`copied ${relative} to dist/`);
