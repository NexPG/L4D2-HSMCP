import { describe, expect, it } from "vitest";
import { parseNavDump } from "../../src/nav/typescript/bsp/navdump.js";

/** Three areas: a checkpoint, a finale area on the flow path, and one that is neither. */
const DUMP = `----------------------------------------------
         Valve Nav Mesh Text Dump v1.0         
----------------------------------------------

Number of Nav Areas: 3


NAV AREA
--------
Center Position: -250.000000, 187.500000, 0.031250
North Connection Count: 1
East Connection Count: 1
South Connection Count: 0
West Connection Count: 0
Up Ladder Count: 0
Down Ladder Count: 0
Base Attribute Flags: 0x20000000
Terror Spawn Attribute Flags: 0x00000800

NAV AREA
--------
Center Position: 462.500000, 0.000000, 0.031250
North Connection Count: 0
East Connection Count: 0
South Connection Count: 0
West Connection Count: 1
Up Ladder Count: 0
Down Ladder Count: 0
Base Attribute Flags: 0x20000000
Terror Spawn Attribute Flags: 0x00000040

NAV AREA
--------
Center Position: 900.000000, 0.000000, 0.031250
North Connection Count: 0
East Connection Count: 0
South Connection Count: 0
West Connection Count: 0
Up Ladder Count: 0
Down Ladder Count: 0
Base Attribute Flags: 0x00000000
Terror Spawn Attribute Flags: 0x00000100
`;

describe("parseNavDump", () => {
  it("reads areas, attributes and the goal, not a flow claim", () => {
    const r = parseNavDump("hsmcp_test_m1_nav.txt", DUMP);
    expect(r.areaCount).toBe(3);
    expect(r.areas).toHaveLength(3);
    expect(r.areas[0]!.center).toEqual([-250, 187.5, 0.03125]);
    expect(r.areas[0]!.attributes).toContain("checkpoint");
    expect(r.areas[0]!.attributes).toContain("mostly-flat");
    expect(r.areas[1]!.attributes).toEqual(["mostly-flat", "finale"]);
    expect(r.areas[2]!.attributes).toEqual(["battlefield"]);
    expect(r.summary).toMatchObject({
      checkpoint: 1,
      finale: 1,
      mostlyFlat: 2,
      areasWithConnections: 2,
      flowProven: false,
    });
    expect(r.verdict).toBe("goal-present");
  });

  it("reads a dump written with CRLF line endings", () => {
    // The engine writes console text with \r\n. `NAV AREA\s*\n-+` consumed the line ending
    // with \s* and then required a second one, so every real dump parsed as zero areas
    // while the area count beside it was correct.
    const crlf = DUMP.replace(/\n/g, "\r\n");
    const r = parseNavDump("x_nav.txt", crlf);
    expect(r.areaCount).toBe(3);
    expect(r.areas).toHaveLength(3);
    expect(r.verdict).toBe("goal-present");
  });

  it("says no-goal when neither CHECKPOINT nor FINALE exists", () => {
    const noGoal = DUMP.replace("0x00000800", "0x00000000").replace("0x00000040", "0x00000000");
    const r = parseNavDump("x_nav.txt", noGoal);
    expect(r.verdict).toBe("no-goal");
  });

  it("does not claim flow from a flag that is MOSTLY_FLAT", () => {
    // 0x20000000 is NAV_MESH_MOSTLY_FLAT. The dump has no flow field, so a goal with no
    // MOSTLY_FLAT area is still only "goal-present"; the live report is the flow oracle.
    const noMostlyFlat = DUMP.split("0x20000000").join("0x00000000");
    const r = parseNavDump("x_nav.txt", noMostlyFlat);
    expect(r.verdict).toBe("goal-present");
    expect(r.summary.mostlyFlat).toBe(0);
    expect(r.summary.flowProven).toBe(false);
  });

  it("refuses a file that is not a dump", () => {
    expect(() => parseNavDump("x.txt", "hello")).toThrow(/not a nav mesh text dump/);
  });
});
