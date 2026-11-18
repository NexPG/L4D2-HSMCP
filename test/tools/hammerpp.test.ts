import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readHammerPlusPlusTool } from "../../src/hammer/typescript/tools/hammerpp.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

describe.skipIf(!has.gameContent)("read_hammerpp", () => {
  it("reads the settings and the game configuration", async () => {
    const r = (await readHammerPlusPlusTool.handler({}, ctx)) as {
      editorPresent: boolean;
      settingsPresent: boolean;
      sections: Record<string, Record<string, string>>;
      important: { ioEsc: boolean | null; ioDelimiter: string | null };
      gameConfig: { gameName: string | null; gameDir: string | null; usingToolsPlusPlus: boolean | null };
      keybindings: { present: boolean; lines: number };
      warnings: string[];
    };
    expect(r.editorPresent).toBe(true);
    expect(r.settingsPresent).toBe(true);
    expect(r.sections["General"]).toBeDefined();
    expect(r.important.ioDelimiter).not.toBeNull();
    expect(r.gameConfig.gameName).toBe("Left 4 Dead 2");
    expect(r.gameConfig.gameDir).toContain("left4dead2");
    expect(r.keybindings.present).toBe(true);
    expect(r.keybindings.lines).toBeGreaterThan(0);
    // This install was repaired; if it is ESC again, the warning must say so.
    if (r.important.ioEsc === true) {
      expect(r.warnings.join(" ")).toMatch(/IOParamNewDelimiter=1/);
    }
  });

  it("filters one section and refuses nothing when it is absent", async () => {
    const r = (await readHammerPlusPlusTool.handler({ section: "View3D" }, ctx)) as {
      sections: Record<string, Record<string, string>>;
    };
    expect(Object.keys(r.sections)).toEqual(["View3D"]);
  });
});
