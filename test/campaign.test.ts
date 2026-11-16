import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseMission, serializeMission, checkMissionStructure, checkMissionFiles } from "../src/campaign/mission.js";
import { checkCampaignTool, readCampaignTool, writeCampaignTool } from "../src/tools/campaign.js";
import { config, ctx as sharedCtx, has } from "./support/env.js";
import type { ToolContext } from "../src/mcp/registry.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "l4d2-campaign-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const MISSION = `"mission"
{
	"Name"		"TESTCAMP"
	"Version"	"1"
	"Author"	"Tester"
	"DisplayTitle"	"#Test_Title"
	"Image"		"maps/test"

	"poster"
	{
		"posterImage"	"LoadingScreen_Test"
	}

	"modes"
	{
		"coop"
		{
			"1"
			{
				"Map" "testm1"
				"DisplayName" "#Chapter_1"
				"Image" "maps/testm1"
			}
			"2"
			{
				"Map" "testm2"
				"DisplayName" "#Chapter_2"
				"Image" "maps/testm2"
			}
		}
		"versus"
		{
			"1"
			{
				"Map" "testm1"
				"DisplayName" "#Chapter_V1"
				"Image" "maps/testm1"
				"VersusCompletionScore" "600"
			}
		}
	}
}
`;

describe("campaign files", () => {
  it("reads the mission wrapper, modes and numbered chapters", () => {
    const m = parseMission(MISSION);
    expect(m.name).toBe("TESTCAMP");
    expect(m.displayTitle).toBe("#Test_Title");
    expect(m.modes.map((x) => x.name)).toEqual(["coop", "versus"]);
    expect(m.modes[0]!.chapters.map((c) => c.map)).toEqual(["testm1", "testm2"]);
    expect(m.modes[0]!.chapters[0]!.displayName).toBe("#Chapter_1");
    expect(m.modes[1]!.chapters[0]!.key).toBe("1");
  });

  it("keeps keys it does not interpret when writing back", () => {
    const m = parseMission(MISSION);
    const text = serializeMission(m);
    const again = parseMission(text);
    expect(again.modes[1]!.chapters[0]!.node.entries.some((e) => e.kind === "pair" && e.key === "VersusCompletionScore")).toBe(true);
    // And the nested poster block survived too.
    expect(text).toContain("posterImage");
  });

  it("refuses a file with no mission wrapper", () => {
    expect(() => parseMission('"Name" "X"\n"modes" { }\n')).toThrow(/no "mission" block/);
  });

  it("reports a gap in chapter numbering", () => {
    const m = parseMission(MISSION);
    m.modes[0]!.chapters[1]!.key = "3";
    expect(checkMissionStructure(m).map((f) => f.rule)).toContain("chapter-numbering");
  });

  it("rejects a Map given with a path or an extension", () => {
    const m = parseMission(MISSION);
    m.modes[0]!.chapters[0]!.map = "maps/testm1.bsp";
    const findings = checkMissionStructure(m);
    expect(findings.find((f) => f.rule === "map-not-a-name")).toBeDefined();
  });

  it("warns when a chapter has no display name", () => {
    const m = parseMission(MISSION);
    m.modes[0]!.chapters[0]!.displayName = null;
    const findings = checkMissionStructure(m);
    expect(findings.find((f) => f.rule === "display-name-missing")?.severity).toBe("warning");
  });
});

describe("checking against files", () => {
  it("finds maps and images that exist, and reports the ones that do not", () => {
    const root = join(scratch, "addon");
    mkdirSync(join(root, "maps"), { recursive: true });
    mkdirSync(join(root, "materials", "vgui", "maps"), { recursive: true });
    writeFileSync(join(root, "maps", "testm1.bsp"), "stub");
    writeFileSync(join(root, "materials", "vgui", "maps", "testm1.vmt"), "stub");

    const m = parseMission(MISSION);
    const clean = checkMissionFiles(
      m,
      { mapsDirs: [join(root, "maps")], materialsDirs: [join(root, "materials")] },
      existsSync,
    );
    // testm2 exists nowhere; testm2's image is therefore reported too.
    expect(clean.filter((f) => f.rule === "map-file-missing")).toHaveLength(1);
    expect(clean.find((f) => f.rule === "map-file-missing")?.message).toContain("testm2");

    writeFileSync(join(root, "maps", "testm2.bsp"), "stub");
    writeFileSync(join(root, "materials", "vgui", "maps", "testm2.vmt"), "stub");
    const full = checkMissionFiles(
      m,
      { mapsDirs: [join(root, "maps")], materialsDirs: [join(root, "materials")] },
      existsSync,
    );
    expect(full).toEqual([]);
  });

  it("accepts a map and an image that live in a VPK", () => {
    const m = parseMission(MISSION);
    const findings = checkMissionFiles(
      m,
      {
        mapsDirs: [],
        materialsDirs: [],
        vpkEntries: new Set([
          "maps/testm1.bsp",
          "maps/testm2.bsp",
          "materials/vgui/maps/testm1.vmt",
          "materials/vgui/maps/testm2.vmt",
        ]),
      },
      existsSync,
    );
    expect(findings).toEqual([]);
  });
});

describe("the campaign tools", () => {
  it("writes a campaign, then refuses to replace it unasked", async () => {
    const out = join(scratch, "campaigns", "test.txt");
    const r = (await writeCampaignTool.handler(
      {
        out,
        name: "TESTCAMP",
        modes: [{ name: "coop", chapters: [{ map: "testm1", displayName: "One" }] }],
        overwrite: false,
        dryRun: false,
        confirm: true,
      } as never,
      ctx,
    )) as { written: boolean; chapterCount: number };
    expect(r.written).toBe(true);
    expect(r.chapterCount).toBe(1);

    const parsed = parseMission(readFileSync(out, "utf8"));
    expect(parsed.name).toBe("TESTCAMP");
    expect(parsed.modes[0]!.chapters[0]!.map).toBe("testm1");

    await expect(async () =>
      writeCampaignTool.handler(
        {
          out,
          name: "TESTCAMP",
          modes: [{ name: "coop", chapters: [{ map: "testm1", displayName: "One" }] }],
          overwrite: false,
          dryRun: false,
          confirm: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/already exists/);
  });

  it("reads a campaign back from the file", async () => {
    const out = join(scratch, "campaigns", "test.txt");
    const r = (await readCampaignTool.handler({ path: out }, ctx)) as {
      name: string;
      modeNames: string[];
      chapterCount: number;
    };
    expect(r.name).toBe("TESTCAMP");
    expect(r.modeNames).toEqual(["coop"]);
    expect(r.chapterCount).toBe(1);
  });

  it.skipIf(!has.sidecar)("reads the game's own campaign from pak01 and checks it", async () => {
    const vpk = config.gameDir ? join(config.gameDir, "pak01_dir.vpk") : "";
    if (!vpk || !existsSync(vpk)) return;
    const read = (await readCampaignTool.handler(
      { vpk, entry: "missions/campaign1.txt" },
      ctx,
    )) as { name: string; modeNames: string[]; chapterCount: number };
    expect(read.name).toBe("L4D2C1");
    expect(read.modeNames).toContain("coop");
    expect(read.chapterCount).toBeGreaterThan(3);

    const checked = (await checkCampaignTool.handler(
      { vpk, entry: "missions/campaign1.txt", vpks: [vpk] },
      ctx,
    )) as { overall: string; findings: Array<{ rule: string }>; counts: { error: number } };
    expect(checked.counts.error).toBe(0);
    expect(checked.findings.filter((f) => f.rule === "map-file-missing")).toEqual([]);
  }, 300_000);
});
