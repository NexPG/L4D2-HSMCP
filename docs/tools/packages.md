# Packaging and VPK

14 tools: addon manifests, VPK build/verify/extract, pakfile and Workshop metadata.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Addon manifests

| Tool | What it does |
|---|---|
| `install_addon` | Copies an addon into the game's `left4dead2/addons`: a `.vpk` as itself, or a staging folder as a folder with the same name. |
| `read_addoninfo` | Reads an `addoninfo.txt`: title, author, version, tag, description, the `addonAICredit` line and every key it contains. |
| `run_vpk_pack` | Packs a staging directory into an addon VPK with the game's own vpk.exe. |
| `validate_addon` | Checks an addon staging folder before it is packed: addoninfo.txt parses and names the game; every `.nut` under scripts/vscripts is read as Squirrel; the three content manifests reference files that exist in the folder or are stock; and a closecaption file is UTF-16LE. |
| `write_addon_scaffold` | Creates the minimum pure-VScript addon layout: `addoninfo.txt` with the AI credit and `scripts/vscripts/mapspawn_addon.nut` with a load banner. |
| `write_addoninfo` | Writes an `addoninfo.txt` without packing an archive: appid 550, title, author, version, tag, tagline and description, plus the `addonAICredit` line with the toolkit version. |
| `write_content_manifest` | Adds or removes entries in a content manifest: `particles_manifest.txt` (`file`), `game_sounds_manifest.txt` (`precache_file`) or `soundscapes_manifest.txt` (`file`). |

## VPK and pakfile

| Tool | What it does |
|---|---|
| `read_vpk` | Lists what is inside a .vpk, and optionally verifies every CRC-32 against the bytes. |
| `run_pakfile_extract` | Extracts files from a compiled map's embedded pakfile (lump 40, a plain ZIP) into a directory. |
| `run_vpk_build` | Builds a version 1 .vpk from a staging directory with this server's own writer: no vpk.exe, no game install. |
| `run_vpk_extract` | Extracts files from a .vpk into a directory. |
| `verify_vpk` | Checks a .vpk for structural defects: the header and tree, duplicate entry paths, entries whose offset and length run past the directory or numbered archive, numbered archives the tree references but the disk lacks, every entry's CRC-32, and on version 2 the tree MD5, the archive-MD5 section's own MD5, the whole-fil... |

## Workshop

| Tool | What it does |
|---|---|
| `read_workshop_vdf` | Reads a `workshop_build_item.vdf`: appid, publishedfileid, contentfolder, previewfile, visibility, title, description and change note. |
| `write_workshop_vdf` | Writes a `workshop_build_item.vdf` for `steamcmd +workshop_build_item`. |
