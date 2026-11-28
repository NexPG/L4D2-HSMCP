# Addons

8 tools: addoninfo, scaffolding, validation and installation.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Addon manifests and installation

| Tool | What it does |
|---|---|
| `install_addon` | Copies an addon into the game's `left4dead2/addons`: a `.vpk` as itself, or a staging folder as a folder with the same name. |
| `read_addoninfo` | Reads an `addoninfo.txt`: title, author, version, tag, description, the `addonAICredit` line and every key it contains. |
| `run_vpk_pack` | Packs a staging directory into an addon VPK with the game's own vpk.exe. |
| `validate_addon` | Checks an addon staging folder before it is packed: addoninfo.txt parses and names the game; every `.nut` under scripts/vscripts is read as Squirrel; the three content manifests reference files that exist in the folder or are stock; and a closecaption file is UTF-16LE. |
| `write_addon_scaffold` | Creates the minimum pure-VScript addon layout: `addoninfo.txt` with the AI credit and `scripts/vscripts/mapspawn_addon.nut` with a load banner. |
| `write_addon_workspace` | Creates `workspaces/<name>/` for one addon or campaign: `plan/`, `templates/`, `logs/`, `src/`, `addon/`, `dist/` and `evidence/`, with a README, a DESIGN.md stub and addoninfo/mission templates. |
| `write_addoninfo` | Writes an `addoninfo.txt` without packing an archive: appid 550, title, author, version, tag, tagline and description, plus the `addonAICredit` line with the toolkit version. |
| `write_content_manifest` | Adds or removes entries in a content manifest: `particles_manifest.txt` (`file`), `game_sounds_manifest.txt` (`precache_file`) or `soundscapes_manifest.txt` (`file`). |
