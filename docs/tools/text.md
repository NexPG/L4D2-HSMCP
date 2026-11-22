# File and text primitives

2 tools: path resolution and raw UTF-8 text files.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Paths and text

| Tool | What it does |
|---|---|
| `read_text_file` | Reads a UTF-8 text file with a byte cap, optional 1-based line window and no binary guessing: a NUL byte is refused. |
| `write_text_file` | Writes arbitrary UTF-8 text: the primitive for QC, SMD, VMT, VTA, DMX and mission files the structured tools do not model. |
