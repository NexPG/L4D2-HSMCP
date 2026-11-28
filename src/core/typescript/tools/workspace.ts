/**
 * Scaffold one addon/campaign workspace.
 *
 * A new request creates `workspaces/<name>/` with the folders the agent will fill: the plan
 * (DESIGN.md), templates (addoninfo, mission), an error log, source, staging, dist and
 * evidence. The folders are the contract; the files are stubs the agent replaces. Nothing is
 * written into the game and no map is created.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { resolveInput } from "./paths.js";

const NAME = /^[a-z0-9][a-z0-9_-]{1,63}$/;

const KIND = z.enum(["campaign", "map", "mutation", "hud", "model", "vscript", "other"]);

const DIRECTORIES = [
  "plan",
  "templates",
  "reference",
  "logs",
  "src",
  "addon",
  "dist",
  "evidence",
] as const;

const write = (path: string, text: string): void => {
  writeFileSync(path, text, "utf8");
};

function readme(
  name: string,
  title: string,
  kind: string,
  author: string,
  created: string,
  mapLike: boolean,
): string {
  return `# ${title}

- Directory: \`${name}\`
- Kind: ${kind}
- Status: planning
- Author: ${author}
- Created: ${created}
- Game: Left 4 Dead 2

## Layout

| Folder | What belongs here |
|---|---|
${mapLike ? "| `plan/` | `plan.json`, `DESIGN.md`, `ASSETS.md` and `drawings/` |\n" : ""}| \`templates/\` | \`addoninfo.txt\`, \`mission.txt\`; copy, replace the placeholders, do not edit in place |
| \`reference/\` | read-only upstream baseline and its provenance; never build from it in place |
| \`logs/\` | \`errors.md\` and \`gate.json\`; symptom -> cause -> fix, and the last gate result |
| \`src/\` | source \`.vmf\`, \`.qc\`, \`.nut\`, \`.txt\` — the files that are compiled |
| \`addon/\` | staging tree: \`addoninfo.txt\`, \`missions/\`, \`maps/\`, \`materials/\`, \`models/\`, \`scripts/\` |
| \`dist/\` | the packed \`.vpk\` |
| \`evidence/\` | screenshots, nav dumps, console logs and gate output |

## Passes

${
  mapLike
    ? `1. **Design (pass 1):** fill \`plan/DESIGN.md\` with the template in
   \`l4d2-hsmcp://skill/workflows/design-a-map.md\` and stop for approval. No \`.vmf\` yet.
2. **Build (pass 2):** copy the templates into \`addon/\`, build into \`src/\`, compile, nav,
   gate and pack. The build may choose exact assets within the palette; a change to the route
   or a beat is a \`## 15. Amendments\` row in the design.`
    : `1. **Design note:** fill \`DESIGN.md\` with what the add-on changes, its settings, its
   conflicts and its compatibility. No map plan is written for this kind.
2. **Build:** copy the templates into \`addon/\`, build into \`src/\`, pack and install.`
}
`;
}

function noteStub(title: string, kind: string): string {
  return `# ${title} — design note

Status: draft
Version: 1
Date: ${new Date().toISOString().slice(0, 10)}
Kind: ${kind}

This kind has no map plan. Record only what matters for an installable add-on:

## What it changes

## Settings

## Conflicts

## Compatibility

## Acceptance
`;
}

function designStub(title: string): string {
  return `# ${title} — design

Status: draft
Version: 1
Date: ${new Date().toISOString().slice(0, 10)}
Built from: (nothing yet)

The full template is \`l4d2-hsmcp://skill/workflows/design-a-map.md\`. Fill every section;
delete a section only when it truly does not apply and say why.

## 1. Pitch and pillars

## 2. Campaign map

| # | Map | Working title | Time | Weather | Goal | Target length |
|---|---|---|---|---|---|---|

## 3. Route, chapter by chapter

## 4. Beat sheet

| # | Chapter | Beat | Type | Space | What changes | Proof |
|---|---|---|---|---|---|---|

## 5. Spaces and rooms

| Space | Size L×W×H | Floors | Entrances | Exits | Cover | Light | Purpose | Palette / props | Nav notes |
|---|---|---|---|---|---|---|---|---|---|

## 6. Verticality and one-way routes

## 7. Events and logic

| Event | Trigger | Entities | Outputs / inputs | Duration | Failure mode |
|---|---|---|---|---|---|

## 8. Finale

## 9. Item and health budget

| Chapter | Weapon spawners | Random layer | Health | Throwables | Ammo | Special |
|---|---:|---:|---:|---:|---:|---|

## 10. Asset palette and motifs

## 11. Variability

## 12. Modes

## 13. Acceptance criteria

## 14. Build order and deferred work

## 15. Amendments

| Date | Change | Why | Replaces |
|---|---|---|---|

## 16. Assumptions and open questions
`;
}

function assetsStub(): string {
  return `# Asset queries

Every material, model, particle and sound named in \`DESIGN.md\` comes from a query, not
memory. Record the query and the answer here.

| Date | Kind | Query | Found | Used as |
|---|---|---|---|---|
`;
}

function addoninfo(title: string, author: string, kind: string): string {
  const content =
    kind === "vscript"
      ? '"addonContent_Script"\t\t"1"'
      : `"addonContent_Campaign"\t\t"${kind === "campaign" || kind === "map" ? "1" : "0"}"`;
  return `"AddonInfo"
{
	"addonSteamAppID"		"550"
	"addontitle"		"${title}"
	"addonauthor"		"${author}"
	"addonversion"		"1"
	${content}
	"addonDescription"		""
}
`;
}

function mission(title: string, author: string, name: string): string {
  return `"mission"
{
	"Name"		"${name.replace(/[^A-Za-z0-9]/g, "")}"
	"Version"		"1"
	"Author"		"${author}"
	"DisplayTitle"		"${title}"
	"Description"		""
	"Image"		"maps/c1"
	"modes"
	{
		"coop"
		{
			"1"
			{
				"Map"		"mapname"
				"DisplayName"		"Chapter One"
			}
		}
	}
}
`;
}

function planExample(title: string): string {
  return JSON.stringify(
    {
      version: 1,
      name: title,
      kind: "map",
      stage: "flow",
      experience: "leave the start house, cross the street and hold the checkpoint",
      pillars: [
        "the street stays visible from the house",
        "every fight has a way around",
        "climb before you drop",
      ],
      districts: [
        {
          id: "beach",
          name: "Beach",
          mood: "exposed",
          motif: "sand and bleached wood",
          landmark: "lifeguard tower",
        },
        {
          id: "town",
          name: "Town",
          mood: "tight",
          motif: "stucco and canvas",
          landmark: "clock tower",
        },
      ],
      site: {
        bounds: { x0: 0, y0: 0, x1: 3072, y1: 3072 },
        north: 0,
        grid: 512,
        water: [],
        noBuild: [],
      },
      terrain: {
        cell: 1024,
        origin: [0, 0],
        cols: 3,
        rows: 3,
        heights: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      buildings: [
        {
          id: "house_a",
          name: "Start house",
          x: 800,
          y: 800,
          width: 512,
          depth: 384,
          rotation: 0,
          floors: 2,
          floorHeight: 128,
          baseZ: 0,
          enterable: true,
          role: "route",
          entrances: [{ x: 1056, y: 800, z: 0, width: 64, face: "east" }],
          floorsPlan: [
            {
              level: 1,
              z: 0,
              height: 128,
              rooms: [{ id: "room", name: "room", x: 56, y: 0, width: 400, depth: 200 }],
              doors: [
                {
                  id: "front",
                  x: 256,
                  y: 0,
                  width: 56,
                  depth: 16,
                  rotation: 90,
                  from: "outside",
                  to: "room",
                  kind: "door",
                },
              ],
              stairs: [{ id: "up", kind: "stair", x: 100, y: 0, width: 48, depth: 96, to: 2 }],
            },
            {
              level: 2,
              z: 128,
              height: 128,
              rooms: [{ id: "upstairs", name: "upstairs", x: 0, y: 0, width: 220, depth: 160 }],
              doors: [],
              stairs: [{ id: "down", kind: "stair", x: 100, y: 0, width: 48, depth: 96, to: 1 }],
            },
          ],
        },
        {
          id: "neighbor_a",
          name: "Neighbor block",
          x: 1800,
          y: 800,
          width: 400,
          depth: 400,
          rotation: 0,
          floors: 2,
          floorHeight: 128,
          baseZ: 0,
          enterable: false,
          role: "context",
          entrances: [],
          floorsPlan: [],
        },
        {
          id: "neighbor_b",
          name: "Street wall",
          x: 1800,
          y: 1700,
          width: 400,
          depth: 400,
          rotation: 0,
          floors: 2,
          floorHeight: 128,
          baseZ: 0,
          enterable: false,
          role: "facade",
          entrances: [],
          floorsPlan: [],
        },
      ],
      routes: [
        {
          id: "critical",
          kind: "critical",
          typology: "string-of-pearls",
          width: 96,
          points: [
            [200, 300, 0],
            [300, 1100, 0],
            [900, 1100, 0],
            [1200, 1100, 0],
            [1200, 700, 0],
            [1056, 800, 0],
          ],
          stops: [
            { id: "start", label: "start", x: 200, y: 300, z: 0, kind: "start" },
            { id: "door", label: "house", x: 1056, y: 800, z: 0, kind: "checkpoint" },
          ],
          nodes: [
            { id: "n_start", label: "start", x: 200, y: 300, z: 0, floor: 1, space: "start yard", district: "beach", kind: "start", enclosure: "open", intensity: 1, landmark: "lifeguard tower", gate: "none", beat: "b1" },
            { id: "n_street", label: "street", x: 700, y: 1100, z: 0, floor: 1, space: "street", district: "beach", kind: "street", enclosure: "open", intensity: 3, landmark: "", gate: "none", beat: "b1" },
            { id: "n_door", label: "door", x: 1056, y: 800, z: 0, floor: 1, buildingId: "house_a", space: "house", district: "town", kind: "door", enclosure: "covered", intensity: 3, landmark: "", gate: "hard", beat: "b2" },
            { id: "n_stair", label: "stair", x: 900, y: 800, z: 0, floor: 1, buildingId: "house_a", space: "house", district: "town", kind: "stair", enclosure: "tight", intensity: 4, landmark: "", gate: "none", beat: "b2" },
            { id: "n_up", label: "upstairs", x: 900, y: 800, z: 128, floor: 2, buildingId: "house_a", space: "upstairs", district: "town", kind: "room", enclosure: "tight", intensity: 2, landmark: "clock tower", gate: "none", beat: "b3" },
            { id: "n_drop", label: "drop", x: 900, y: 800, z: 0, floor: 1, buildingId: "house_a", space: "upstairs", district: "town", kind: "drop", enclosure: "vista", intensity: 2, landmark: "clock tower", gate: "one-way", beat: "b3" },
            { id: "n_end", label: "exit", x: 1056, y: 800, z: 0, floor: 1, buildingId: "house_a", space: "exit", district: "town", kind: "checkpoint", enclosure: "covered", intensity: 2, landmark: "", gate: "none", beat: "b3" },
          ],
        },
      ],
      areas: [
        {
          id: "spawn",
          label: "start",
          kind: "spawn",
          x: 200,
          y: 300,
          width: 256,
          depth: 256,
          rotation: 0,
          note: "player start",
        },
        {
          id: "street",
          label: "street cover",
          kind: "cover",
          x: 700,
          y: 1100,
          width: 160,
          depth: 96,
          rotation: 0,
          note: "waist-high",
        },
        {
          id: "hold",
          label: "holdout",
          kind: "holdout",
          x: 900,
          y: 1100,
          width: 192,
          depth: 192,
          rotation: 0,
          note: "crescendo hold",
        },
      ],
      beats: [
        {
          id: "b1",
          chapter: 1,
          type: "quiet",
          space: "beach",
          what: "the sea is visible",
          proof: "screenshot",
          intensity: 1,
        },
        {
          id: "b2",
          chapter: 1,
          type: "fight",
          space: "house",
          what: "the stair fight",
          proof: "spawn count",
          intensity: 3,
        },
        {
          id: "b3",
          chapter: 1,
          type: "crescendo",
          space: "upstairs",
          what: "the drop and the checkpoint",
          proof: "STAGE_DONE",
          intensity: 5,
        },
      ],
      budget: { weapon_item_spawn: 8 },
      palette: {
        sky: "sky_l4d_c1_1_hdr",
        motifs: ["wood", "stucco", "metal"],
        materials: [],
        models: [],
      },
      variability: [],
      acceptance: ["gate pass"],
    },
    null,
    2,
  );
}

export const writeAddonWorkspaceTool = defineTool({
  name: "write_addon_workspace",
  description:
    "Creates `workspaces/<name>/` for one addon or campaign: `plan/`, `templates/`, `logs/`, " +
    "`src/`, `addon/`, `dist/` and `evidence/`, with a README, a DESIGN.md stub and " +
    "addoninfo/mission templates. The directory is named after the addon. It writes no map " +
    "and no game file; an existing non-empty directory is refused unless `overwrite: true`. " +
    "Guarded.",
  realm: "local",
  guarded: true,
  inputSchema: {
    name: z
      .string()
      .regex(NAME, "lowercase slug: a-z, 0-9, hyphens or underscores, 2-64 characters")
      .describe("Directory name, the addon's name, e.g. `santa-monica`."),
    title: z.string().optional().describe("Display title; defaults to the name."),
    kind: KIND.default("campaign"),
    author: z
      .string()
      .optional()
      .describe("The person making the content. Omit when unknown; the template says so."),
    overwrite: z
      .boolean()
      .default(false)
      .describe("Write the missing files into an existing non-empty workspace."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    name: z.string(),
    created: z.array(z.string()),
    skipped: z.array(z.string()),
    note: z.string(),
  },
  handler: (args, ctx) => {
    if (!args.confirm) {
      throw new Error("confirm:true is required: this creates a workspace directory");
    }
    const title = args.title?.trim() || args.name;
    const author = args.author?.trim() || ctx.config.addonAuthor?.trim() || "(ask the user)";
    const mapLike = args.kind === "campaign" || args.kind === "map";
    const root = join(resolveInput("workspaces", ctx.config), args.name);
    if (existsSync(root) && readdirSync(root).length > 0 && !args.overwrite) {
      throw new Error(
        `${root} already exists and is not empty; pass overwrite: true to add missing files`,
      );
    }

    const created: string[] = [];
    const skipped: string[] = [];
    const directories = mapLike ? DIRECTORIES : DIRECTORIES.filter((directory) => directory !== "plan");
    for (const directory of directories) {
      const path = join(root, directory);
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
        created.push(`${directory}/`);
      }
    }

    const files: Array<[string, string]> = [
      [
        "README.md",
        readme(
          args.name,
          title,
          args.kind,
          author,
          new Date().toISOString().slice(0, 10),
          mapLike,
        ),
      ],
      [
        "reference/README.md",
        "# Reference\n\nRead-only upstream baseline for this add-on. Put the unmodified download, " +
          "extracted tree or source snapshot here, with its Workshop/file URL, date, author and " +
          "licence in this README. Do not build from it in place; copy what the fork needs into " +
          "`src/` or `addon/`.\n",
      ],
      ["templates/README.md", `# Templates\n\nCopy these into \`addon/\` and replace the placeholders. The design and the build decide the values.\n`],
      ["templates/addoninfo.txt", addoninfo(title, author, args.kind)],
      ["logs/errors.md", "# Error log\n\n| Date | Symptom | Cause | Fix |\n|---|---|---|---|\n"],
      [
        "logs/README.md",
        "# Logs\n\n`errors.md` is the symptom -> cause -> fix record. `gate.json` is the last `run_campaign_gate` result; keep the attempt date in the name when you keep more than one.\n",
      ],
      ["src/README.md", "# Source\n\n`.vmf`, `.qc`, `.nut` and `.txt` sources. This is what is compiled; `addon/` is the staging tree.\n"],
      ["addon/README.md", "# Staging\n\n`addoninfo.txt`, `missions/`, `maps/`, `materials/`, `models/`, `scripts/`. Copy the templates here; do not edit `templates/` in place.\n"],
      ["dist/README.md", "# Dist\n\nThe packed `.vpk`. `campaigns/` and `workspaces/` are local; the game holds only the latest deploy.\n"],
      ["evidence/README.md", "# Evidence\n\nScreenshots, nav dumps, console logs and gate output for this attempt.\n"],
    ];
    if (mapLike) {
      files.push(
        ["plan/DESIGN.md", designStub(title)],
        ["plan/ASSETS.md", assetsStub()],
        ["plan/plan.example.json", planExample(title)],
        ["templates/mission.txt", mission(title, author, title)],
      );
    } else {
      files.push(["DESIGN.md", noteStub(title, args.kind)]);
    }

    for (const [relative, text] of files) {
      const path = join(root, relative);
      if (existsSync(path)) {
        skipped.push(relative);
        continue;
      }
      write(path, text);
      created.push(relative);
    }

    return {
      path: root,
      name: args.name,
      created,
      skipped,
      note: mapLike
        ? "Pass 1 starts in plan/DESIGN.md and stops for approval; no .vmf is written yet. " +
          "The addoninfo and mission templates are in templates/, not in the staging tree."
        : "Fill DESIGN.md with the change, settings, conflicts and compatibility; no map plan " +
          "is written for this kind. The addoninfo template is in templates/, not in the staging tree.",
    };
  },
});

export const workspaceTools = [writeAddonWorkspaceTool];
