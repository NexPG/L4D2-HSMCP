/**
 * Generates `docs/tools/` from the registry, so the tool catalogue cannot drift from the
 * tools it describes.
 *
 * The sphere is the source area (`src/maps`, `src/models`, ...). Inside a sphere, tools are
 * grouped by a curated topic list, because a file-per-table would produce sixty tables for
 * maps and say nothing a reader wants. The tool description is the first sentence: the full
 * text lives in the tool's own definition and in the skill catalogue.
 *
 * `test/tools/docs.test.ts` compares this output with the files on disk. After adding or
 * renaming a tool, run `pnpm docs:tools`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allTools } from "../../../registry.js";

interface Sphere {
  slug: string;
  title: string;
  covers: string;
}

const SPHERES: Sphere[] = [
  {
    slug: "maps",
    title: "Maps, VMF and BSP",
    covers: "creating and editing .vmf, brushes, entities, faces, displacements, compile, audit and offline views",
  },
  {
    slug: "models",
    title: "Models",
    covers: "compiled MDL/VVD/VTX/PHY, decompiling and compiling, QC/SMD, collision, animation, LODs and effects",
  },
  {
    slug: "textures",
    title: "Textures and materials",
    covers: "VTF encode/decode, VMT, PBR checks, cubemaps, skyboxes and loading screens",
  },
  {
    slug: "assets",
    title: "Game assets",
    covers: "what the game's VPKs contain, surface properties, particles and previews",
  },
  {
    slug: "audio",
    title: "Audio",
    covers: "soundscripts, soundscapes and WAV",
  },
  {
    slug: "campaigns",
    title: "Campaigns",
    covers: "mission files, modes, finales, gates, posters and campaign scaffolding",
  },
  {
    slug: "nav",
    title: "Navigation",
    covers: "nav areas, attributes, connections, hiding spots, encounters, path and sight queries",
  },
  {
    slug: "scripts",
    title: "VScript and runtime",
    covers: "Squirrel source, scenes, runtime probes, the console channel and weather",
  },
  {
    slug: "hammer",
    title: "Hammer and the live editor",
    covers: "editor status, launch, capture, menus and the staged live-edit queue",
  },
  {
    slug: "formats",
    title: "Shared formats",
    covers: "DMX datamodels",
  },
  {
    slug: "packages",
    title: "Packaging and VPK",
    covers: "addon manifests, VPK build/verify/extract, pakfile and Workshop metadata",
  },
  {
    slug: "core",
    title: "Core and configuration",
    covers: "health, the addon author, game discovery, paths and text",
  },
];

/** Topic tables per sphere. Every tool file with a registered tool must appear here. */
const GROUPS: Record<string, Record<string, string[]>> = {
  maps: {
    "Map files and entities": ["vmf", "vmfedit", "wiring", "worldspawn", "entityextras", "entityfamilies", "entityprobe", "detail", "sequences", "autosave", "assets", "door", "exportmap", "diff"],
    "Geometry": ["build", "solids", "clip", "carve", "hull", "merge", "hollow", "vertex", "snap", "modify"],
    "Faces, materials and lighting": ["face", "lightmap", "lightmaps", "overlay", "overlays", "dressing", "terrain", "water", "cubemapgrid", "displacement"],
    "Compile, pack and audit": ["compile", "report", "review", "rules", "deps", "pakfileadd", "rename", "bsp", "bspedit", "bsplump", "staticprops"],
    "Rendering and space": ["render", "renderbsp", "plan", "measure", "measurespace", "space", "vis", "visleaf"],
    "Instances and prefabs": ["instance", "instancecollapse", "instancecreate", "prefab"],
    "Organisation and optimisation": ["organise", "optimise"],
    "Navigation in maps": ["navattrs"],
  },
  models: {
    "Inspection and source": ["source", "check"],
    "Decompile and compile": ["decompile", "studiomdl"],
    "QC and interchange": ["qc", "smd", "dmxsmd", "gltf", "gltfdmx", "fbx"],
    "Collision and physics": ["collision", "brush"],
    "Skeleton and animation": ["skeleton", "animation", "ani"],
    "Flexes and VTA": ["flexes", "vta"],
    "Eyes, jigglebones and procedural bones": ["eyes", "jiggle", "procedural"],
    "LODs and bodygroups": ["lods", "bodygroups"],
    "Preview": ["preview"],
  },
  textures: {
    "VTF": ["vtf", "vtfconvert", "vtfgen"],
    "VMT and material checks": ["vmt", "vmtcheck", "materials"],
    "Cubemaps and skyboxes": ["cubemap", "buildcubemaps", "skybox", "skyboxbuild", "skyboxcopy"],
    "Screens and UI": ["loadingscreen", "rect"],
  },
  assets: {
    "Content catalogue and game data": ["content", "surfaceprops", "localization"],
    "Particles": ["particles", "particlecheck"],
    "Model preview": ["preview"],
  },
  audio: {
    "Soundscripts and soundscapes": ["soundscripts", "soundcheck", "soundscapes"],
    "WAV": ["wav"],
  },
  campaigns: {
    "Campaign and mission files": ["campaign", "modes", "gameplay", "gate", "finale", "poster"],
    "Campaign scaffolding": ["campaignbuild"],
  },
  nav: {
    "Areas, attributes and connections": ["navareas", "navconnections", "navdetails"],
    "Path and sight queries": ["navpath"],
    "Troubleshooting": ["navtrouble"],
  },
  scripts: {
    "VScript and scenes": ["vscript", "scene"],
    "Runtime harness": ["runtime", "console", "weather"],
    "Probes": ["classprobe", "navprobe"],
  },
  hammer: {
    "Editor status and launch": ["hammer", "hammerpp", "hlmv", "windows", "capture"],
    "Live edits": ["hammerlive", "livequeue"],
    "Synthetic input": ["input"],
  },
  formats: {
    "DMX": ["dmx"],
  },
  packages: {
    "Addon manifests": ["addon", "addoncheck", "manifests"],
    "VPK and pakfile": ["vpk", "vpkverify", "pakfile"],
    "Workshop": ["workshop"],
  },
  core: {
    "Health and author identity": ["health", "author"],
    "Game discovery": ["games"],
    "Paths and text": ["paths", "text"],
  },
};

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

function toolFileMap(root: string): Map<string, { sphere: string; file: string }> {
  const byName = new Map<string, { sphere: string; file: string }>();
  for (const sphere of SPHERES) {
    const dir = join(root, "src", sphere.slug, "typescript", "tools");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const file = name.slice(0, -3);
      const text = readFileSync(join(dir, name), "utf8");
      for (const match of text.matchAll(/\bname:\s*"([a-z][a-z0-9_]*)"/g)) {
        const tool = match[1]!;
        const previous = byName.get(tool);
        if (previous && (previous.sphere !== sphere.slug || previous.file !== file)) {
          throw new Error(
            `tool ${tool} is defined in both ${previous.sphere}/${previous.file} and ${sphere.slug}/${file}`,
          );
        }
        byName.set(tool, { sphere: sphere.slug, file });
      }
    }
  }
  return byName;
}

export function buildToolCatalog(root: string): ToolCatalog {
  const located = toolFileMap(root);
  const bySphere = new Map<string, Map<string, ToolDocEntry[]>>();
  const missing: string[] = [];
  for (const tool of allTools) {
    const spot = located.get(tool.name);
    if (!spot) {
      missing.push(tool.name);
      continue;
    }
    const groups = GROUPS[spot.sphere];
    if (!groups) throw new Error(`no groups for sphere ${spot.sphere}`);
    const group = Object.entries(groups).find(([, files]) => files.includes(spot.file))?.[0];
    if (!group) {
      throw new Error(
        `no topic table for ${spot.sphere}/${spot.file}; add it to GROUPS in src/core/typescript/docs/toolcatalog.ts`,
      );
    }
    const byFile = bySphere.get(spot.sphere) ?? new Map<string, ToolDocEntry[]>();
    const list = byFile.get(group) ?? [];
    list.push({
      name: tool.name,
      description: firstSentence(tool.description),
      file: spot.file,
    });
    byFile.set(group, list);
    bySphere.set(spot.sphere, byFile);
  }
  if (missing.length > 0) {
    throw new Error(
      `tools with no source file (add the file to the map, or check the name): ${missing.join(", ")}`,
    );
  }

  const counts: Record<string, number> = {};
  for (const sphere of SPHERES) {
    counts[sphere.slug] = [...(bySphere.get(sphere.slug)?.values() ?? [])].reduce(
      (sum, list) => sum + list.length,
      0,
    );
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  const readme = [
    "# Tools by area",
    "",
    `${total} tools. The server is a tool factory: the named builders are shortcuts, and the`,
    "primitives stay reachable. This page is generated from the registry by",
    "`pnpm docs:tools`; edit a tool's description, not this file.",
    "",
    "| Area | Covers | Tools | Reference |",
    "|---|---|---:|---|",
    ...SPHERES.map(
      (sphere) =>
        `| ${sphere.title} | ${sphere.covers} | ${counts[sphere.slug]} | [${sphere.slug}.md](${sphere.slug}.md) |`,
    ),
    `| **Total** | | **${total}** | |`,
    "",
    "The per-area pages group tools into logical tables (for example, a VPK table and a",
    "material table inside Packaging), with one row per tool and what it does.",
    "",
  ].join("\n");

  const files: Record<string, string> = {};
  for (const sphere of SPHERES) {
    const groups = bySphere.get(sphere.slug) ?? new Map<string, ToolDocEntry[]>();
    const lines = [
      `# ${sphere.title}`,
      "",
      `${counts[sphere.slug]} tools: ${sphere.covers}.`,
      "",
      `Part of the [tool catalogue](README.md). Generated from the registry by \`pnpm docs:tools\`.`,
      "",
    ];
    for (const group of Object.keys(GROUPS[sphere.slug] ?? {})) {
      const entries = groups.get(group);
      if (!entries || entries.length === 0) continue;
      lines.push(`## ${group}`, "", "| Tool | What it does |", "|---|---|");
      for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(`| \`${entry.name}\` | ${entry.description} |`);
      }
      lines.push("");
    }
    files[`${sphere.slug}.md`] = lines.join("\n");
  }
  return { readme, files, total, counts };
}
