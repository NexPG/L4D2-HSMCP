# Shared formats

2 tools: DMX datamodels.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## DMX

| Tool | What it does |
|---|---|
| `read_dmx` | Reads a .dmx datamodel (binary or KeyValues2) as a JSON element tree: header encoding, format name/version, root type, element counts by type, and every attribute with its type and value. |
| `write_dmx` | Builds a .dmx from a JSON element tree and reads the written file back to prove the parser sees the same root. |
