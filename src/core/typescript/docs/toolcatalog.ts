/**
 * Generates `docs/tools/` from the registry, so the catalogue cannot drift from the tools it
 * describes.
 *
 * **One area is one logical job, not a source directory.** `Maps` is not a bucket for VMF
 * authoring, compilation, BSP analysis, rendering and measurement; those are separate rows
 * with separate pages. A tool that belongs to a new job means a new area and a new row — do
 * not fold it into an existing area because its source file happens to live there.
 *
 * `test/tools/docs.test.ts` compares this output with the files. After adding or renaming a
 * tool, run `pnpm docs:tools`; an unassigned tool file fails generation rather than being
 * hidden in an "Other" table.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allTools } from "../../../registry.js";

interface Area {
  slug: string;
  title: string;
  covers: string;
  /** Logical tables inside the area: title -> source tool files. */
  groups: Record<string, string[]>;
}

const AREAS: Area[] = [
  {
    slug: "vmf",
    title: "VMF authoring",
    covers: "source maps: files, entities, brushes, faces, lighting, overlays, instances, terrain and weather",
    groups: {
      "Files, entities and wiring": ["vmf", "fgdresources", "vmfedit", "wiring", "worldspawn", "entityextras", "entityfamilies", "entityprobe", "detail", "autosave", "door", "diff", "exportmap", "bench"],
      "Geometry": ["build", "solids", "clip", "carve", "hull", "merge", "hollow", "vertex", "snap", "modify"],
      "Faces, lighting, overlays and terrain": ["face", "lightmap", "lightmaps", "overlay", "overlays", "dressing", "water", "terrain", "displacement", "cubemapgrid"],
      "Instances and prefabs": ["instance", "instancecollapse", "instancecreate", "prefab", "prefabcatalog", "entitygroup"],
      "Organisation and optimisation": ["organise", "optimise"],
      "Weather": ["weather"],
      "Map analysis and leak": ["scene"],
    },
  },
  {
    slug: "compilation",
    title: "Map compilation",
    covers: "running vbsp/vvis/vrad, the Hammer++ chain, compile logs and sequences",
    groups: {
      "Compile and run": ["compile"],
      "Editor Run Map sequences": ["sequences"],
    },
  },
  {
    slug: "audit",
    title: "Map audit and rules",
    covers: "reviewing a source map, map rules, missing assets and dependencies",
    groups: { "Audit and rules": ["report", "review", "rules", "deps"] },
  },
  {
    slug: "bsp",
    title: "Compiled maps (BSP)",
    covers: "BSP lumps, entity lumps, pakfile, static props, map rename and compiled-map reports",
    groups: {
      "BSP readers and writers": ["bsp", "bspedit", "bsplump"],
      "Static props, pakfile and assets": ["staticprops", "pakfileadd", "rename", "assets"],
    },
  },
  {
    slug: "rendering",
    title: "Rendering and measurement",
    covers: "offline views and plans, room/space measurement, visibility and sight lines",
    groups: {
      "Views and plans": ["render", "renderbsp", "plan"],
      "Space and visibility": ["measure", "measurespace", "space", "vis", "visleaf"],
    },
  },
  {
    slug: "nav",
    title: "Navigation",
    covers: "nav areas, attributes, connections, hiding spots, encounters, path and sight queries",
    groups: {
      "Areas, attributes and connections": ["navareas", "navconnections", "navdetails", "maps/navattrs"],
      "Path and sight queries": ["navpath"],
      "Troubleshooting": ["navtrouble"],
      "Edit records": ["navwrite"],
    },
  },
  {
    slug: "models",
    title: "Models",
    covers: "compiled MDL/VVD/VTX/PHY, decompiling and compiling, QC/SMD, collision, animation, LODs and effects",
    groups: {
      "Inspection": ["check"],
      "Decompile and compile": ["decompile", "studiomdl"],
      "QC and interchange": ["qc", "smd", "dmxsmd", "gltf", "gltfdmx", "fbx"],
      "Collision and physics": ["collision", "brush"],
      "Skeleton and animation": ["skeleton", "animation", "ani"],
      "Flexes and VTA": ["flexes", "vta"],
      "Eyes, jigglebones and procedural bones": ["eyes", "jiggle", "procedural"],
      "Model keyvalues": ["keyvalues"],
      "LODs and bodygroups": ["lods", "bodygroups"],
      "Preview": ["models/preview"],
    },
  },
  {
    slug: "textures",
    title: "Textures (VTF)",
    covers: "reading, writing, converting and extracting VTF textures",
    groups: { "VTF": ["vtf", "vtfcheck", "vtfconvert", "vtfgen"] },
  },
  {
    slug: "materials",
    title: "Materials (VMT and PBR)",
    covers: "VMT read/write, engine-read checks, PBR parameters and the game's surface properties",
    groups: { "VMT and surface properties": ["vmt", "vmtcheck", "materials", "surfaceprops"] },
  },
  {
    slug: "cubemaps",
    title: "Cubemaps and skyboxes",
    covers: "building and converting cubemaps, six-face skyboxes and the sky_camera",
    groups: { "Cubemaps and skyboxes": ["cubemap", "buildcubemaps", "skybox", "skyboxbuild", "skyboxcopy"] },
  },
  {
    slug: "ui",
    title: "Screens and UI",
    covers: "loading screens, VGUI HUD .res screens and Hammer++ .rect hotspot rectangles",
    groups: { "Screens and UI": ["loadingscreen", "rect", "hud"] },
  },
  {
    slug: "particles",
    title: "Particles",
    covers: "particle systems, their materials and map effect references",
    groups: { "Particles": ["particles", "particlecheck"] },
  },
  {
    slug: "content",
    title: "Game content",
    covers: "searching the game's VPKs, localization and asset previews",
    groups: { "Content catalogue and previews": ["content", "localization", "assets/preview"] },
  },
  {
    slug: "audio",
    title: "Audio",
    covers: "soundscripts, soundscapes and WAV",
    groups: {
      "Soundscripts and soundscapes": ["soundscripts", "soundcheck", "soundscapes"],
      "WAV": ["wav"],
    },
  },
  {
    slug: "choreo",
    title: "Choreography and scenes",
    covers: "VCD timelines, actor channels, events and the scenes.image summary",
    groups: { "Scenes and scene images": ["choreo"] },
  },
  {
    slug: "campaigns",
    title: "Campaigns",
    covers: "mission files, modes, finales, gates, posters and campaign scaffolding",
    groups: {
      "Campaign and mission files": ["campaign", "modes", "gameplay", "gate", "finale", "poster", "itemdensity"],
      "Campaign scaffolding": ["campaignbuild"],
    },
  },
  {
    slug: "mutations",
    title: "Game modes and mutations",
    covers: "modes/*.txt definitions, MutationOptions scripts, validation and add-on scaffolding",
    groups: { "Mutation definitions and scaffolding": ["mutations"] },
  },
  {
    slug: "vscript",
    title: "VScript authoring",
    covers: "Squirrel source: writing and checking .nut files, DirectorOptions and include paths",
    groups: { "VScript source": ["vscript"] },
  },
  {
    slug: "runtime",
    title: "Runtime harness",
    covers: "launching and probing the game: run_map_test, nav generation, console commands and class/nav probes",
    groups: {
      "Game runs and probes": ["runtime", "classprobe", "navprobe", "optionsprobe", "siprobe"],
      "Console channel": ["console"],
    },
  },
  {
    slug: "hammer",
    title: "Hammer editor",
    covers: "editor status, Hammer++ settings, launching, window capture and HLMV",
    groups: { "Editor status and launch": ["hammer", "hammerpp", "hlmv", "windows", "capture"] },
  },
  {
    slug: "live",
    title: "Live editing",
    covers: "editing the open map through Hammer's shell channel, and the staged approval queue",
    groups: { "Live edits": ["hammerlive", "livequeue"] },
  },
  {
    slug: "input",
    title: "Input automation",
    covers: "synthetic key presses for interactions a console command cannot express",
    groups: { "Keyboard input": ["input"] },
  },
  {
    slug: "addons",
    title: "Addons",
    covers: "addoninfo, scaffolding, validation, installation and Workshop metadata",
    groups: { "Addon manifests and installation": ["addon", "addoncheck", "manifests", "workshop"] },
  },
  {
    slug: "vpk",
    title: "VPK and pakfile",
    covers: "building, reading, extracting and verifying VPK archives, and editing a map's pakfile",
    groups: { "VPK and pakfile": ["vpk", "vpkverify", "pakfile"] },
  },
  {
    slug: "formats",
    title: "Shared formats",
    covers: "DMX datamodels",
    groups: { "DMX": ["dmx"] },
  },
  {
    slug: "configuration",
    title: "Configuration and health",
    covers: "toolchain health and the stored add-on author",
    groups: { "Health and author identity": ["health", "author", "gamestate"] },
  },
  {
    slug: "games",
    title: "Game discovery",
    covers: "how Left 4 Dead 2 was found on this machine",
    groups: { "Installed games": ["games"] },
  },
  {
    slug: "text",
    title: "File and text primitives",
    covers: "path resolution and raw UTF-8 text files",
    groups: { "Paths and text": ["text"] },
  },
];

/**
 * A file appears in exactly one area, except where a file genuinely hosts two jobs. Each
 * exception is explicit and named; it is not a licence to mix areas.
 */
const TOOL_AREA_OVERRIDES: Record<string, string> = {};

export interface ToolDocEntry {
  name: string;
  description: string;
  file: string;
}

export interface ToolCatalog {
  readme: string;
  files: Record<string, string>;
  total: number;
  counts: Record<string, number>;
}

function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const stop = clean.indexOf(". ");
  const sentence = stop > 30 ? clean.slice(0, stop + 1) : clean;
  return (sentence.length > 320 ? `${sentence.slice(0, 317)}...` : sentence).replace(/\|/g, "\\|");
}

interface Located {
  area: string;
  file: string;
  key: string;
}

function toolFileMap(root: string): Map<string, Located> {
  const sourceDir = join(root, "src");
  const available = new Map<
    string,
    { key: string; sphere: string; file: string; names: string[] }
  >();
  for (const sphere of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!sphere.isDirectory()) continue;
    const dir = join(sourceDir, sphere.name, "typescript", "tools");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const file = name.slice(0, -3);
      const text = readFileSync(join(dir, name), "utf8");
      const registered = new Set(allTools.map((tool) => tool.name));
      const names = [...text.matchAll(/\bname:\s*"([a-z][a-z0-9_]*)"/g)]
        .map((match) => match[1]!)
        .filter((name) => registered.has(name));
      if (names.length === 0) continue;
      const key = `${sphere.name}/${file}`;
      available.set(key, { key, sphere: sphere.name, file, names });
    }
  }

  const resolve = (entry: string): string => {
    if (entry.includes("/")) {
      if (!available.has(entry)) {
        throw new Error(`area lists ${entry}, but no tool file has that path`);
      }
      return entry;
    }
    const matches = [...available.values()].filter((candidate) => candidate.file === entry);
    if (matches.length === 0) {
      throw new Error(`area lists ${entry}, but no tool file has that name`);
    }
    if (matches.length > 1) {
      throw new Error(
        `tool file name ${entry} is ambiguous (${matches.map((match) => match.key).join(", ")}); ` +
          "write the sphere/file path in the area table",
      );
    }
    return matches[0]!.key;
  };

  const byName = new Map<string, Located>();
  const assigned = new Map<string, string>();
  for (const area of AREAS) {
    for (const files of Object.values(area.groups)) {
      for (const entry of files) {
        const key = resolve(entry);
        const previous = assigned.get(key);
        if (previous && previous !== area.slug) {
          throw new Error(`tool file ${key} is assigned to both ${previous} and ${area.slug}`);
        }
        assigned.set(key, area.slug);
        const location = available.get(key)!;
        for (const tool of location.names) {
          const areaForTool = TOOL_AREA_OVERRIDES[tool] ?? area.slug;
          const existing = byName.get(tool);
          if (existing) {
            throw new Error(`tool ${tool} is defined twice (${existing.file} and ${location.file})`);
          }
          byName.set(tool, { area: areaForTool, file: location.file, key });
        }
      }
    }
  }
  for (const key of available.keys()) {
    if (!assigned.has(key)) {
      throw new Error(
        `tool file ${key} has tools but no area; add it to an area in ` +
          "src/core/typescript/docs/toolcatalog.ts (do not create an Other bucket)",
      );
    }
  }
  return byName;
}

export function buildToolCatalog(root: string): ToolCatalog {
  const located = toolFileMap(root);
  const byArea = new Map<string, Map<string, ToolDocEntry[]>>();
  const missing: string[] = [];
  for (const tool of allTools) {
    const spot = located.get(tool.name);
    if (!spot) {
      missing.push(tool.name);
      continue;
    }
    const area = AREAS.find((candidate) => candidate.slug === spot.area);
    if (!area) throw new Error(`no area named ${spot.area}`);
    const group = Object.entries(area.groups).find(
      ([, files]) => files.includes(spot.file) || files.includes(spot.key),
    )?.[0];
    if (!group) {
      throw new Error(`no topic table for ${spot.area}/${spot.file}`);
    }
    const byFile = byArea.get(spot.area) ?? new Map<string, ToolDocEntry[]>();
    const list = byFile.get(group) ?? [];
    list.push({
      name: tool.name,
      description: firstSentence(tool.description),
      file: spot.file,
    });
    byFile.set(group, list);
    byArea.set(spot.area, byFile);
  }
  if (missing.length > 0) {
    throw new Error(
      `tools with no source file (add the file to an area, or check the name): ${missing.join(", ")}`,
    );
  }

  const counts: Record<string, number> = {};
  for (const area of AREAS) {
    counts[area.slug] = [...(byArea.get(area.slug)?.values() ?? [])].reduce(
      (sum, list) => sum + list.length,
      0,
    );
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  const readme = [
    "# Tools by area",
    "",
    `${total} tools. One area is one logical job — VMF authoring, compilation, BSP analysis,`,
    "rendering, the runtime harness, and so on — not a source directory and not a bucket for",
    "several jobs. A new kind of tool gets a new row and a new page.",
    "",
    "This page is generated from the registry by `pnpm docs:tools`; edit a tool's description,",
    "not this file.",
    "",
    "| Area | Covers | Tools | Reference |",
    "|---|---|---:|---|",
    ...AREAS.map(
      (area) =>
        `| ${area.title} | ${area.covers} | ${counts[area.slug]} | [${area.slug}.md](${area.slug}.md) |`,
    ),
    `| **Total** | | **${total}** | |`,
    "",
    "Each area page has logical tables inside it (for example, “Geometry”, “Faces, lighting,",
    "overlays and terrain” and “Instances and prefabs” inside VMF authoring).",
    "",
  ].join("\n");

  const files: Record<string, string> = {};
  for (const area of AREAS) {
    const groups = byArea.get(area.slug) ?? new Map<string, ToolDocEntry[]>();
    const lines = [
      `# ${area.title}`,
      "",
      `${counts[area.slug]} tools: ${area.covers}.`,
      "",
      `Part of the [tool catalogue](README.md). Generated from the registry by \`pnpm docs:tools\`.`,
      "",
    ];
    for (const group of Object.keys(area.groups)) {
      const entries = groups.get(group);
      if (!entries || entries.length === 0) continue;
      lines.push(`## ${group}`, "", "| Tool | What it does |", "|---|---|");
      for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(`| \`${entry.name}\` | ${entry.description} |`);
      }
      lines.push("");
    }
    files[`${area.slug}.md`] = lines.join("\n");
  }
  return { readme, files, total, counts };
}
