/**
 * MCP prompts for the skill's workflows.
 *
 * A resource is a document the client can read; a prompt is a task the client can start with
 * arguments already filled in. These prompts do not repeat the workflow pages — they route
 * to the resource and put the caller's map/screen/material in front of it, so there is one
 * copy of the instructions.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const TASK = z.string().describe("What the user wants to build, fix or check.");
const SCREEN = z.string().describe("HUD resource path, e.g. resource/ui/l4d360ui/audio.res.");
const CHANGE = z.string().describe("The change: a control/value target, offset or goal.");
const MATERIAL = z.string().describe("Material path or internal material name.");
const MAP = z.string().describe("Path to the .bsp or .vmf.");
const FACE = z.string().describe("Face index, as read_bsp_lightmaps reports it.");
const VMF = z.string().describe("Path to the .vmf to compile.");
const SEQUENCE = z.string().describe("Run Map sequence name.");

export interface SkillPrompt {
  name: string;
  title: string;
  description: string;
  args: Record<string, z.ZodTypeAny>;
  render: (args: Record<string, string | undefined>) => string;
}

const given = (value: string | undefined): string => value?.trim() || "(not given)";

export const SKILL_PROMPTS: readonly SkillPrompt[] = [
  {
    name: "l4d2_task",
    title: "Plan an L4D2 task with the skill",
    description: "Route a map, campaign, model, material or runtime task through the skill.",
    args: { task: TASK },
    render: (args) =>
      `Use the L4D2-HSMCP skill at l4d2-hsmcp://skill/SKILL.md.\n\n` +
      `Task: ${given(args.task)}\n\n` +
      `Read SKILL.md and the workflow or reference it routes this task to before acting. ` +
      `If the task is a new map or campaign and there is no approved DESIGN.md, do pass 1 ` +
      `(workflows/design-a-map.md) and stop; do not build in the same message. ` +
      `Use the MCP tools for file work; do not guess a format. If the task depends on an ` +
      `item under "What is not supported", say so plainly instead of faking the step.`,
  },
  {
    name: "l4d2_design_map",
    title: "Design a map or campaign (pass 1)",
    description: "Write a complete DESIGN.md route, rooms, beats, finale, palette and budget.",
    args: { brief: TASK },
    render: (args) =>
      `Use the L4D2-HSMCP skill page l4d2-hsmcp://skill/workflows/design-a-map.md.\n\n` +
      `Brief: ${given(args.brief)}\n\n` +
      `Pass 1 only. Create the workspace with write_addon_workspace, then use read-only tools ` +
      `to query every asset, class and peer number, write ` +
      `workspaces/<addon-name>/plan/DESIGN.md with the full template, set Status: draft, report ` +
      `the path and stop for approval. Do not create a .vmf and do not start the build.`,
  },
  {
    name: "l4d2_build_from_design",
    title: "Build from an approved design (pass 2)",
    description: "Build the map or campaign that DESIGN.md describes.",
    args: { design: z.string().describe("Path to workspaces/<addon-name>/plan/DESIGN.md.") },
    render: (args) =>
      `Use the L4D2-HSMCP skill page l4d2-hsmcp://skill/workflows/new-campaign.md.\n\n` +
      `Design: ${given(args.design)}\n\n` +
      `Pass 2. Read the design, confirm Status: approved, and build chapter by chapter in its ` +
      `§14 order. Choose exact assets within its palette; do not change the route, a room's ` +
      `purpose, a beat or the finale type without an approved §15 amendment.`,
  },
  {
    name: "l4d2_hud_override",
    title: "Override a stock HUD screen",
    description: "Read a VPK .res, edit or shift it, and write an add-on copy.",
    args: { screen: SCREEN, change: CHANGE },
    render: (args) =>
      `Use the L4D2-HSMCP skill page l4d2-hsmcp://skill/workflows/hud-override.md.\n\n` +
      `Stock screen: ${given(args.screen)}\nRequested change: ${given(args.change)}\n\n` +
      `Follow the page: read with read_hud(fromGame), edit or offset with write_hud(out), ` +
      `verify the written .res and preserve every condition.`,
  },
  {
    name: "l4d2_material_edit",
    title: "Edit a material or reskin",
    description: "Change one VMT value and check a patch include.",
    args: { material: MATERIAL, change: CHANGE },
    render: (args) =>
      `Use the L4D2-HSMCP skill page l4d2-hsmcp://skill/workflows/material-edit.md.\n\n` +
      `Material: ${given(args.material)}\nRequested change: ${given(args.change)}\n\n` +
      `Follow the page: read_vmt tree, edit_vmt for an existing value, check_vmt with ` +
      `materialsDirs for the base and textures, then pack.`,
  },
  {
    name: "l4d2_compiled_light",
    title: "Fix one face's baked light",
    description: "Patch LDR lightmap luxels without re-running vrad.",
    args: { map: MAP, face: FACE, change: CHANGE },
    render: (args) =>
      `Use the L4D2-HSMCP skill page l4d2-hsmcp://skill/workflows/compiled-light-fix.md.\n\n` +
      `Map: ${given(args.map)}\nFace: ${given(args.face)}\nRequested change: ${given(args.change)}\n\n` +
      `Follow the page: read_bsp_lightmaps first, then write_bsp_lightmap with dryRun or out, ` +
      `and read the face back. LDR only; HDR is refused by design.`,
  },
  {
    name: "l4d2_editor_sequence",
    title: "Run the editor's own compile sequence",
    description: "Reproduce Hammer's F9 steps, with a dry run first.",
    args: { vmf: VMF, sequence: SEQUENCE },
    render: (args) =>
      `Use the L4D2-HSMCP skill page l4d2-hsmcp://skill/workflows/editor-sequence.md.\n\n` +
      `Map: ${given(args.vmf)}\nSequence: ${given(args.sequence)}\n\n` +
      `Follow the page: read_compile_sequences, then run_compile_sequence(dryRun) and only ` +
      `then confirm:true. Use run_compile for func_instance maps.`,
  },
];

/** Registers the skill prompts. Returns how many were registered. */
export function registerSkillPrompts(server: McpServer): number {
  for (const prompt of SKILL_PROMPTS) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: prompt.args,
      },
      (args) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: prompt.render((args ?? {}) as Record<string, string | undefined>),
            },
          },
        ],
      }),
    );
  }
  return SKILL_PROMPTS.length;
}
