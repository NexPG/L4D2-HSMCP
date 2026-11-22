import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  readAddonInfoTool,
  writeAddonInfoTool,
} from "../../src/packages/typescript/tools/addon.js";
import {
  readLocalizationTool,
  writeLocalizationTool,
} from "../../src/assets/typescript/tools/localization.js";
import { readDetailSpritesTool, writeDetailSpritesTool } from "../../src/maps/typescript/tools/detail.js";
import {
  readMissionPosterTool,
  writeMissionPosterTool,
} from "../../src/campaigns/typescript/tools/poster.js";
import { readWorkshopVdfTool, writeWorkshopVdfTool } from "../../src/packages/typescript/tools/workshop.js";
import { ctx as sharedCtx } from "../support/env.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-readers-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const path = (name: string) => join(scratch, name);

describe("read back what the writers wrote", () => {
  it("reads addoninfo and localization", async () => {
    const info = path("addoninfo.txt");
    await writeAddonInfoTool.handler(
      { path: info, title: "Reader Test", author: "Tester", confirm: true } as never,
      ctx,
    );
    const addon = (await readAddonInfoTool.handler({ path: info } as never, ctx)) as unknown as {
      title: string | null;
      aiCredit: string | null;
    };
    expect(addon.title).toBe("Reader Test");
    expect(addon.aiCredit).toContain("L4D2-HSMCP");

    const loc = path("closecaption_english.txt");
    await writeLocalizationTool.handler(
      { path: loc, language: "English", tokens: { "[english]A": "One" }, confirm: true } as never,
      ctx,
    );
    const read = (await readLocalizationTool.handler({ path: loc } as never, ctx)) as unknown as {
      encoding: string;
      language: string | null;
      tokenCount: number;
    };
    expect(read.encoding).toBe("utf16le");
    expect(read.language).toBe("English");
    expect(read.tokenCount).toBe(1);
  });

  it("reads a detail type, a mission poster and a Workshop VDF", async () => {
    const detail = path("detail.vbsp");
    await writeDetailSpritesTool.handler(
      { path: detail, name: "grass", density: 500, confirm: true } as never,
      ctx,
    );
    const types = (await readDetailSpritesTool.handler({ path: detail } as never, ctx)) as unknown as {
      types: Array<{ name: string; density: string | null }>;
    };
    expect(types.types[0]?.name).toBe("grass");
    expect(types.types[0]?.density).toBe("500");

    const mission = path("mission.txt");
    writeFileSync(
      mission,
      '"mission"\n{\n\t"Name"\t"Test"\n\t"modes"\n\t{\n\t\t"coop"\n\t\t{\n\t\t\t"1"\n\t\t\t{\n\t\t\t\t"Map"\t"m1"\n\t\t\t}\n\t\t}\n\t}\n}\n',
    );
    await writeMissionPosterTool.handler(
      { path: mission, image: "LoadingScreen_Test", confirm: true } as never,
      ctx,
    );
    const poster = (await readMissionPosterTool.handler({ path: mission } as never, ctx)) as unknown as {
      found: boolean;
      image: string | null;
    };
    expect(poster.found).toBe(true);
    expect(poster.image).toBe("LoadingScreen_Test");

    const addonDir = path("workshop-addon");
    mkdirSync(addonDir, { recursive: true });
    writeFileSync(join(addonDir, "addoninfo.txt"), '"addoninfo"\n{\n}\n');
    const vdf = path("workshop_build_item.vdf");
    await writeWorkshopVdfTool.handler(
      { contentFolder: addonDir, out: vdf, title: "Workshop Test", confirm: true } as never,
      ctx,
    );
    const item = (await readWorkshopVdfTool.handler({ path: vdf } as never, ctx)) as unknown as {
      title: string | null;
      contentFolder: string | null;
    };
    expect(item.title).toBe("Workshop Test");
    expect(item.contentFolder).toBe(addonDir);
  });
});
