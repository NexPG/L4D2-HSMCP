import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { get, children, parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";

/**
 * Hammer++'s own state, as a structured answer.
 *
 * The editor is a Windows application, but almost everything it decides is in three text
 * files: `hammerplusplus_settings.ini`, `hammerplusplus_gameconfig.txt` and
 * `hammerplusplus_keybindings.cfg`. This reads them, reports the settings that change
 * output, and says which build programs/FGD the game configuration actually points at.
 */
function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = "General";
  out[section] = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1]!;
      out[section] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    out[section]![line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function firstBlock(block: KvBlock, name: string): KvBlock | undefined {
  return children(block, name)[0];
}

export const readHammerPlusPlusTool = defineTool({
  name: "read_hammerpp",
  description:
    "Reads Hammer++'s own configuration: `hammerplusplus_settings.ini` by section, the game " +
    "configuration (game directory, executable, FGD, BSP/VIS/RAD/MDL programs), and the " +
    "keybinding count. Returns the settings that change a map — I/O delimiter, precise " +
    "vertex data, HDR preview, 4-way blends, instance collapse, autosave, Steam support — " +
    "with warnings where the value is wrong for L4D2 or unverified. `health` is the short " +
    "answer; this is the whole file. Local and read-only.",
  realm: "local",
  inputSchema: {
    section: z
      .string()
      .optional()
      .describe("Return only one INI section, e.g. `General` or `View3D`."),
  },
  outputSchema: {
    editor: z.string().nullable(),
    editorPresent: z.boolean(),
    settingsPath: z.string().nullable(),
    settingsPresent: z.boolean(),
    sections: z.record(z.record(z.string())),
    important: z.object({
      ioDelimiter: z.string().nullable(),
      ioEsc: z.boolean().nullable(),
      vertexData: z.string().nullable(),
      microgrid: z.string().nullable(),
      hdr: z.string().nullable(),
      skybox3d: z.string().nullable(),
      gizmoEnabled: z.string().nullable(),
      pivot: z.string().nullable(),
      enable4WayBlends: z.string().nullable(),
      instanceCollapseHidden: z.string().nullable(),
      autosaveEnabled: z.string().nullable(),
      useSteam: z.string().nullable(),
    }),
    gameConfig: z.object({
      path: z.string().nullable(),
      present: z.boolean(),
      gameName: z.string().nullable(),
      gameDir: z.string().nullable(),
      gameExe: z.string().nullable(),
      fgd: z.string().nullable(),
      bsp: z.string().nullable(),
      vis: z.string().nullable(),
      light: z.string().nullable(),
      mdl: z.string().nullable(),
      mapDir: z.string().nullable(),
      usingToolsPlusPlus: z.boolean().nullable(),
    }),
    keybindings: z.object({ path: z.string().nullable(), present: z.boolean(), lines: z.number() }),
    fgds: z.array(z.object({ name: z.string(), path: z.string(), present: z.boolean() })),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const bin = join(dirname(gameDir), "bin");
    const hp = join(bin, "hammerplusplus");
    const editor = join(bin, "hammerplusplus.exe");
    const settingsPath = join(hp, "hammerplusplus_settings.ini");
    const settingsPresent = existsSync(settingsPath);
    const allSections = settingsPresent
      ? parseIni(readFileSync(settingsPath, "utf8"))
      : {};
    const sections =
      args.section !== undefined
        ? Object.fromEntries(
            Object.entries(allSections).filter(([name]) => name.toLowerCase() === args.section!.toLowerCase()),
          )
        : allSections;
    const general = allSections["General"] ?? {};
    const ioDelimiter = general["IOParamNewDelimiter"] ?? null;
    const ioEsc = ioDelimiter === null ? null : ioDelimiter === "1";

    const warnings: string[] = [];
    if (ioEsc === true) {
      warnings.push(
        "IOParamNewDelimiter=1: Hammer++ is writing ESC-separated entity outputs and L4D2 " +
          "will ignore every one. Set `Use special I/O delimiter (ESC)` off (0).",
      );
    }
    if (ioEsc === null && settingsPresent) {
      warnings.push("IOParamNewDelimiter is absent; Hammer++'s default is game-dependent. Check the UI.");
    }
    if (general["VertexData"] === "0") {
      warnings.push("VertexData=0: precise brush data is off; brushes can drift between sessions.");
    }
    if (general["Enable4WayBlends"] === "1") {
      warnings.push(
        "Enable4WayBlends=1: L4D2 shader support for 4-way blend data is unverified in this project.",
      );
    }
    if (general["HDR"] === "0") {
      warnings.push("HDR=0: L4D2 renders HDR by default; LDR lighting preview is less accurate.");
    }

    const configPath = join(hp, "hammerplusplus_gameconfig.txt");
    const configPresent = existsSync(configPath);
    let gameName: string | null = null;
    let gameRoot: KvBlock | undefined;
    let hammer: KvBlock | undefined;
    if (configPresent) {
      const root = parse(readFileSync(configPath, "utf8")).find(
        (n): n is KvBlock => n.kind === "block" && n.name === "Configs",
      );
      const games = root ? firstBlock(root, "Games") : undefined;
      if (games) {
        const game = games.entries.find((e): e is KvBlock => e.kind === "block");
        gameName = game?.name ?? null;
        gameRoot = game;
        hammer = game ? firstBlock(game, "Hammer") : undefined;
      }
    }
    const value = (key: string): string | null => (hammer ? get(hammer, key) ?? null : null);
    const bsp = value("BSP");
    const vis = value("Vis");
    const light = value("Light");
    const mdl = value("MDL");
    const usingPlusPlus =
      bsp === null && vis === null && light === null
        ? null
        : [bsp, vis, light].every((p) => p !== null && /\+{2}\.exe$/i.test(p));

    const keybindingsPath = join(hp, "hammerplusplus_keybindings.cfg");
    const keybindingsPresent = existsSync(keybindingsPath);
    const keybindingsLines = keybindingsPresent
      ? readFileSync(keybindingsPath, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "").length
      : 0;

    const fgds = [
      { name: "left4dead2.fgd", path: join(bin, "left4dead2.fgd") },
      { name: "base.fgd", path: join(bin, "base.fgd") },
      { name: "toolsplusplus.fgd", path: join(bin, "toolsplusplus.fgd") },
      {
        name: "L4D2-FGD-Edits/left4dead2_ADDON.fgd",
        path: join(bin, "L4D2-FGD-Edits", "left4dead2_ADDON.fgd"),
      },
      {
        name: "hammerplusplus_fgd.fgd",
        path: join(hp, "hammerplusplus_fgd.fgd"),
      },
    ].map((f) => ({ ...f, present: existsSync(f.path) }));

    return {
      editor,
      editorPresent: existsSync(editor),
      settingsPath,
      settingsPresent,
      sections,
      important: {
        ioDelimiter,
        ioEsc,
        vertexData: general["VertexData"] ?? null,
        microgrid: general["Microgrid"] ?? null,
        hdr: general["HDR"] ?? null,
        skybox3d: general["Skybox3D"] ?? null,
        gizmoEnabled: general["GizmoEnabled"] ?? null,
        pivot: general["Pivot"] ?? null,
        enable4WayBlends: general["Enable4WayBlends"] ?? null,
        instanceCollapseHidden: general["InstanceCollapseHidden"] ?? null,
        autosaveEnabled: general["AutosaveEnabled"] ?? null,
        useSteam: general["UseSteam"] ?? null,
      },
      gameConfig: {
        path: configPath,
        present: configPresent,
        gameName,
        gameDir: gameRoot ? get(gameRoot, "GameDir") ?? null : null,
        gameExe: value("GameExe"),
        fgd: value("GameData0"),
        bsp,
        vis,
        light,
        mdl,
        mapDir: value("MapDir"),
        usingToolsPlusPlus: usingPlusPlus,
      },
      keybindings: {
        path: keybindingsPath,
        present: keybindingsPresent,
        lines: keybindingsLines,
      },
      fgds,
      warnings,
    };
  },
});

export const hammerPlusPlusTools = [readHammerPlusPlusTool];
