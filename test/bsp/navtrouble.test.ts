import { describe, expect, it } from "vitest";
import {
  offlineNavTrouble,
  parseNavTrouble,
  parseSavedSelection,
  parseSelectedPositions,
} from "../../src/bsp/navtrouble.js";
import { parseNavDump } from "../../src/bsp/navdump.js";

const ENGINE = `
Orphan check passed
Missing Battlefield check passed
Missing Finale check found 3 areas
Missing Checkpoint check passed
Overlap check passed
Corner-to-corner connection check passed
Climb links from stairs check passed
Selected 7 trouble areas
`;

const DUMP = `Number of Nav Areas: 3

NAV AREA
--------
Center Position: 0.000000, 0.000000, 0.031250
North Connection Count: 1
East Connection Count: 0
South Connection Count: 0
West Connection Count: 0
Base Attribute Flags: 0x20000000
Terror Spawn Attribute Flags: 0x00000800

NAV AREA
--------
Center Position: 500.000000, 0.000000, 0.031250
North Connection Count: 0
East Connection Count: 0
South Connection Count: 0
West Connection Count: 1
Base Attribute Flags: 0x20000000
Terror Spawn Attribute Flags: 0x00000040

NAV AREA
--------
Center Position: 900.000000, 0.000000, 0.031250
North Connection Count: 0
East Connection Count: 0
South Connection Count: 0
West Connection Count: 0
Base Attribute Flags: 0x00000000
Terror Spawn Attribute Flags: 0x00000000
`;

const SELECTED = `"Selected Nav Areas"
{
	"Version"		"1"
	"312"
	{
		"NorthWest"
		{
			"x"		"375.000000"
			"y"		"3225.000000"
			"z"		"240.031250"
		}
		"NorthEast"
		{
			"x"		"400.000000"
			"y"		"3225.000000"
			"z"		"240.031250"
		}
		"SouthWest"
		{
			"x"		"375.000000"
			"y"		"3250.000000"
			"z"		"240.031250"
		}
		"SouthEast"
		{
			"x"		"400.000000"
			"y"		"3250.000000"
			"z"		"240.031250"
		}
		"Attributes"		"536870912"
		"SpawnAttributes"		"100663296"
	}
	"498"
	{
		"NorthWest"
		{
			"x"		"0.000000"
			"y"		"375.000000"
			"z"		"-159.968750"
		}
		"NorthEast"
		{
			"x"		"75.000000"
			"y"		"375.000000"
			"z"		"-159.968750"
		}
		"SouthWest"
		{
			"x"		"0.000000"
			"y"		"400.000000"
			"z"		"-127.968750"
		}
		"SouthEast"
		{
			"x"		"75.000000"
			"y"		"400.000000"
			"z"		"-127.968750"
		}
		"East"
		{
			"0"		"499"
		}
		"West"
		{
			"0"		"497"
		}
		"Attributes"		"0"
		"SpawnAttributes"		"100663296"
	}
}
`;

describe("parseNavTrouble", () => {
  it("turns the engine's checks into passes and failures", () => {
    const r = parseNavTrouble(ENGINE);
    expect(r.checks).toHaveLength(7);
    expect(r.failures).toEqual([
      { name: "Missing Finale", passed: false, areas: 3, raw: "Missing Finale check found 3 areas" },
    ]);
    expect(r.selectedAreas).toBe(7);
    expect(r.verdict).toBe("fail");
  });

  it("does not call an empty log a pass", () => {
    const r = parseNavTrouble("Unknown command \"nav_trouble_report\"");
    expect(r.checks).toEqual([]);
    expect(r.verdict).toBe("unknown");
  });

  it("reads 'found 0 areas' as a pass", () => {
    const r = parseNavTrouble("Tiny nav area check found 0 areas");
    expect(r.checks[0]).toMatchObject({ name: "Tiny nav area", passed: true, areas: 0 });
    expect(r.verdict).toBe("pass");
  });
});

describe("parseSavedSelection", () => {
  it("reads areas, corners, attributes and connections", () => {
    const areas = parseSavedSelection(SELECTED);
    expect(areas).toHaveLength(2);
    expect(areas[0]).toMatchObject({
      id: 312,
      center: [387.5, 3237.5, 240.03125],
      attributes: 536870912,
      spawnAttributes: 100663296,
      connections: [],
    });
    expect(areas[1]!.connections).toEqual([499, 497]);
  });

  it("returns nothing for a file that is not a selected set", () => {
    expect(parseSavedSelection("versioninfo\n{\n}\n")).toEqual([]);
  });

  it("still reads the xyz form when a tool has one", () => {
    expect(parseSelectedPositions("1 2 3\n4 5 6\nbad\n")).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });
});

describe("offlineNavTrouble", () => {
  const connected = DUMP.replace(
    "Center Position: 900.000000, 0.000000, 0.031250\nNorth Connection Count: 0",
    "Center Position: 900.000000, 0.000000, 0.031250\nNorth Connection Count: 1",
  ).replace("0x00000800", "0x00000880");
  const report = parseNavDump("x_nav.txt", DUMP);

  it("passes a mesh with the goal it needs and no orphans", () => {
    expect(offlineNavTrouble(parseNavDump("x_nav.txt", connected), "checkpoint").verdict).toBe(
      "pass",
    );
  });

  it("fails a last chapter with no FINALE area", () => {
    const noFinale = DUMP.replace("0x00000040", "0x00000000");
    const r = offlineNavTrouble(parseNavDump("x_nav.txt", noFinale), "finale");
    expect(r.verdict).toBe("fail");
    expect(r.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "nav-missing-finale" })]),
    );
  });

  it("reports an orphan with its centre", () => {
    const r = offlineNavTrouble(report, "checkpoint");
    // The dump has one area with no connections; it is also off the escape route.
    expect(r.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "nav-orphan", count: 1, centers: [[900, 0, 0.03125]] }),
      ]),
    );
  });

  it("fails when a goal has no escape route", () => {
    const noFlow = DUMP.split("0x20000000").join("0x00000000");
    const r = offlineNavTrouble(parseNavDump("x_nav.txt", noFlow), "checkpoint");
    expect(r.verdict).toBe("fail");
    expect(r.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "nav-no-escape-route" })]),
    );
  });
});
