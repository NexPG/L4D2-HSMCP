# VPK and pakfile

5 tools: building, reading, extracting and verifying VPK archives, and editing a map's pakfile.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## VPK and pakfile

| Tool | What it does |
|---|---|
| `read_vpk` | Lists what is inside a .vpk, and optionally verifies every CRC-32 against the bytes. |
| `run_pakfile_extract` | Extracts files from a compiled map's embedded pakfile (lump 40, a plain ZIP) into a directory. |
| `run_vpk_build` | Builds a version 1 .vpk from a staging directory with this server's own writer: no vpk.exe, no game install. |
| `run_vpk_extract` | Extracts files from a .vpk into a directory. |
| `verify_vpk` | Checks a .vpk for structural defects: the header and tree, duplicate entry paths, entries whose offset and length run past the directory or numbered archive, numbered archives the tree references but the disk lacks, every entry's CRC-32, and on version 2 the tree MD5, the archive-MD5 section's own MD5, the whole-fil... |
