// One-off: build the first two-chapter test campaign through the tools themselves.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { allTools } from "../../dist/tools/index.js";
import { loadConfig } from "../../dist/config.js";

const cfg = loadConfig(process.cwd());
const ctx = { config: cfg, audit: { record() {}, path: "campaign-build" } };
const call = async (name, args) => {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(args, ctx);
};

const ROOT = "campaigns/hsmcp-test";
const SRC = join(ROOT, "src");
const ADDON = join(ROOT, "addon");
for (const dir of [SRC, join(ADDON, "maps"), join(ADDON, "missions")]) {
  mkdirSync(dir, { recursive: true });
}

// Interior 768 x 512 x 192, walls 32 thick, one divider with a doorway.
const SHELL = [
  { shape: "box", mins: [-384, -256, -32], maxs: [384, 256, 0] },
  { shape: "box", mins: [-384, -256, 192], maxs: [384, 256, 224] },
  { shape: "box", mins: [-416, -256, 0], maxs: [-384, 256, 192] },
  { shape: "box", mins: [384, -256, 0], maxs: [416, 256, 192] },
  { shape: "box", mins: [-384, -288, 0], maxs: [384, -256, 192] },
  { shape: "box", mins: [-384, 256, 0], maxs: [384, 288, 192] },
  { shape: "box", mins: [-16, -256, 0], maxs: [16, -48, 192] },
  { shape: "box", mins: [-16, 48, 0], maxs: [16, 256, 192] },
  { shape: "box", mins: [-16, -48, 128], maxs: [16, 48, 192] },
];

async function buildMap(name, extraOps, brushEntity) {
  const vmf = join(SRC, `${name}.vmf`);
  rmSync(vmf, { force: true });
  await call("write_vmf", {
    path: vmf,
    skyname: "sky_l4d_c1_1",
    gridSpacing: 64,
    dryRun: false,
    confirm: true,
  });
  await call("write_vmf_solid", {
    path: vmf,
    solids: SHELL,
    material: "BRICK/BRICK_EXT_01",
    confirm: true,
  });
  const edit = await call("edit_vmf", {
    path: vmf,
    ops: extraOps,
    confirm: true,
  });
  if (brushEntity) {
    const idx = extraOps.findIndex((o) => o.keyvalues.classname === brushEntity.classname);
    const id = edit.outcomes[idx].ids[0];
    await call("write_vmf_solid", {
      path: vmf,
      entityId: id,
      solids: [brushEntity.solid],
      material: brushEntity.material ?? "TOOLS/TOOLSTRIGGER",
      confirm: true,
    });
  }
  return vmf;
}

const common = [
  { op: "add", keyvalues: { classname: "info_player_start", origin: "-300 0 16", angles: "0 0 0" } },
  { op: "add", keyvalues: { classname: "light", origin: "0 0 160", _light: "255 255 255 600" } },
  { op: "add", keyvalues: { classname: "info_director", origin: "0 0 32" } },
  { op: "add", keyvalues: { classname: "info_zombie_spawn", origin: "200 0 16" } },
];

const m1 = await buildMap(
  "hsmcp_test_m1",
  [
    ...common,
    { op: "add", keyvalues: { classname: "trigger_changelevel", map: "hsmcp_test_m2", targetname: "to_m2" } },
  ],
  {
    classname: "trigger_changelevel",
    solid: { shape: "box", mins: [280, -64, 0], maxs: [360, 64, 128] },
  },
);

const m2 = await buildMap(
  "hsmcp_test_m2",
  [
    ...common,
    { op: "add", keyvalues: { classname: "trigger_finale", origin: "300 0 64", targetname: "finale" } },
  ],
);

for (const [vmf, name] of [[m1, "hsmcp_test_m1"], [m2, "hsmcp_test_m2"]]) {
  const leak = await call("read_vmf_leak", { path: vmf, step: 16 });
  console.log(name, "sealed:", leak.sealed);
  const lint = await call("read_vmf_lint", { path: vmf, limit: 50, collapseInstances: false });
  console.log(name, "lint:", lint.total, lint.byRule);
  const r = await call("run_compile", {
    vmf,
    fast: true,
    hdr: false,
    stages: ["vbsp", "vvis", "vrad"],
    toolchain: "plusplus",
    cull: true,
    timeoutMinutes: 10,
    confirm: true,
  });
  console.log(name, "compile:", r.toolchain, r.ok, r.stages.map((s) => `${s.stage}:${s.exitCode}`).join(" "));
  if (!r.ok) throw new Error(`compile failed for ${name}`);
  copyFileSync(join(SRC, `${name}.bsp`), join(ADDON, "maps", `${name}.bsp`));
}

await call("write_campaign", {
  out: join(ADDON, "missions", "hsmcp_test.txt"),
  name: "HSMCP_TEST",
  displayTitle: "HSMCP Test",
  description: "A two-chapter test campaign built by the tools.",
  author: "NexPG",
  modes: [
    {
      name: "coop",
      chapters: [
        { map: "hsmcp_test_m1", displayName: "Chapter One" },
        { map: "hsmcp_test_m2", displayName: "Chapter Two" },
      ],
    },
  ],
  overwrite: true,
  dryRun: false,
  confirm: true,
});

const checked = await call("check_campaign", {
  path: join(ADDON, "missions", "hsmcp_test.txt"),
  mapsDirs: [join(ADDON, "maps")],
  materialsDirs: [join(ADDON, "materials")],
});
console.log("campaign:", checked.overall, checked.counts, checked.findings);

const packed = await call("run_vpk_pack", {
  dir: ADDON,
  out: join(ROOT, "hsmcp-test.vpk"),
  overwrite: true,
  addoninfo: { title: "HSMCP Test", author: "NexPG", description: "Two-chapter test campaign" },
  confirm: true,
});
console.log("vpk:", packed.entryCount, packed.bytes, packed.verified);
