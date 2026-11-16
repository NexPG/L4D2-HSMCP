# Changelog

Versions follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`, with a
prerelease suffix (`-alpha`, `-beta`) while the toolchain is still being proven on the
target game. A version is bumped in the same commit as the change it describes, together
with a line here.

## 0.0.13-alpha — 2026-11-17

- The upstream credit names the original developers' studio, **Project Society Studio**, and
  stops there: the README does not restate a copyright line, because `LICENSE-MIT` already
  carries the MIT notice verbatim.

## 0.0.12-alpha — 2026-11-17

- README drops the "What works today" feature table. The project has only just entered
  development, and the page now says so plainly: the map and campaign pipeline is the first
  piece being built, and the feature set will keep expanding.
- Upstream credit names **Project Society Studio**, which is how the original authors identify
  themselves; the MIT notice in `LICENSE-MIT` is unchanged.

## 0.0.11-alpha — 2026-11-17

- README gains a full Requirements section: L4D2 (app 550) and its Authoring Tools (app 563),
  Node, pnpm, Python/srctools, Windows, disk; recommended Hammer++ and standalone Tools++,
  the VTF tools, Steam for nav and testing; and the agent side (MCP client, skill,
  permission to run local tools and launch the game once per map for nav).

## 0.0.10-alpha — 2026-11-17

- README rewritten around what this project is: an agent toolkit for Left 4 Dead 2 maps,
  campaigns, VScripts, models and addons. It states the early-development status, how the
  pieces fit together, what works today and what is planned.
- `docs/campaigns.md` added: mission format and naming rules, addon layout, nav generation,
  deployment, and the checks `check_campaign` performs.
- Provenance points at `Sycatle/hammer-mcp`, the upstream this fork grew from; the MIT
  notice and copyright remain in `LICENSE-MIT`.

## 0.0.9-alpha — 2026-11-17

- Gate F answered: `nav_generate` runs in the client's listen server, not a dedicated
  binary, and it requires `sv_cheats 1` **and** `nav_edit 1`; without `nav_edit` it does
  nothing. The map must be loose, because a `.nav` cannot be written beside a map inside a
  VPK.
- `campaigns/001-hsmcp-test/nav.ps1` automates the loop: loose maps, generate, collect
  `nav/`, restore the game config, re-pack and deploy.
- Both maps now carry analysed nav meshes (version 16/14, `savedBspSize` matches), and the
  addon has 6 entries (two maps, two navs, mission, manifest).
- A transition needs a landmark: both maps carry `info_landmark landmark_transition` and
  `trigger_changelevel.landmark` points at it.

## 0.0.8-alpha — 2026-11-16

- The project moved to its own repository, `NexPG/L4D2-HSMCP`, with the full history. The
  old fork's remote is gone; metadata, clone URL and CI badge point at the new home.
- The upstream MIT notice and the provenance in `NOTICE` stay exactly where the licences
  require them.

## 0.0.7-alpha — 2026-11-16

- Campaign metadata is now shaped the way L4D2 matches it: the mission file's base name
  equals the VPK's (`hsmcp_campaign.txt` in `hsmcp_campaign.vpk`), `"Name"` is alphanumeric,
  and `"Image"` is set. The addon manifest carries `addonSteamAppID 550` and
  `addonContent_Campaign 1`.
- The staging tree is cleaned before a rebuild, so a renamed mission cannot survive and
  register a second campaign.

## 0.0.6-alpha — 2026-11-16

- `campaigns/` is ignored as a directory (root-anchored `/campaigns/`), not merely for the
  files inside it.
- Deployment keeps exactly one campaign in the game: the build removes earlier
  `hsmcp*.vpk` archives from `left4dead2/addons/` and copies the new one as
  `hsmcp_campaign.vpk`. History stays in the numbered campaign directories, where any run
  can be rebuilt and deployed again.

## 0.0.5-alpha — 2026-11-16

- Test campaigns are local only (`campaigns/` is ignored) and live in numbered directories:
  a README stating the date, project version, what was attempted and what came out, plus
  the source maps, staging tree, build script and packed VPK.
- The build script deploys the archive to the game's `left4dead2/addons/`, so a campaign
  can be opened in the game directly.
- `001-hsmcp-test` re-laid out under that convention.

## 0.0.4-alpha — 2026-11-16

- First campaign built through the tools: two sealed chapters with a transition and a
  finale, a mission file, an addon manifest and a packed VPK. `check_campaign` passes on
  the unpacked tree and on the archive itself.
- `campaigns/hsmcp-test/` keeps the source `.vmf` files, the mission and a `build.mjs` that
  reproduces the build; compiled maps and the VPK are build output.

## 0.0.3-alpha — 2026-11-16

- `run_vpk_pack`: packs a staging directory into an addon VPK with the game's own
  `vpk.exe`, writes the addon manifest when given one, and reads the archive back through
  the sidecar to prove every staging file made it in. Overwrites only on request.
- The pack output is an ordinary L4D2 addon tree: `addoninfo.txt`, `missions/`, `maps/`,
  `materials/vgui/maps/`.

## 0.0.2-alpha — 2026-11-16

- Campaign files: `read_campaign`, `write_campaign` and `check_campaign`. The schema was
  read from the game's own `missions/campaign1.txt` inside `pak01_dir.vpk`; a campaign can
  be written, checked against its maps and images, and the game's own campaigns can be
  checked in place.
- The sidecar can list and read VPK entries (`vpk_list`, `vpk_read`), so campaigns and
  their maps are checked without extracting a 1 GB archive.
- Sky checks accept Left 4 Dead 2's `_hdr`-prefixed sky faces, and dependency resolution
  does the same; `write_vmf` now defaults to `sky_l4d_c1_1`, a sky this game really has.
- The probe fixture is compiled by this game's own compilers (BSP 21, L4D2 field order),
  not inherited from Garry's Mod.
- Test environment: the repo root default was one level too high, which had silently
  skipped every game-content test on a normal checkout. With it fixed, 1020 tests pass on
  Windows against the real install.

## 0.0.1-alpha — 2026-11-16

First version of the Left 4 Dead 2 fork.

- Targets **Left 4 Dead 2 only** (BSP 21, `left4dead2.fgd`, game appid 550). Other Source
  games and the Garry's Mod subsystems were removed.
- **Windows only**: the game's own compilers run natively; the Wine/Proton layer and the
  Linux paths are gone.
- Reads L4D2's lump directory, whose field order differs from every other Source game.
  Counts on `c1m1_hotel.bsp` match Valve's `vbspinfo` exactly.
- Compiles with the stock chain and with standalone **Tools++** (`vbsp++.exe` family),
  naming the chain that actually ran.
- Python sidecar (srctools 2.7.0) installed and used for FGD, VMF and VPK work.
- 71 tools. Tests pass on Windows with the game installed (947 passed, 94 skipped at the
  time of writing).
