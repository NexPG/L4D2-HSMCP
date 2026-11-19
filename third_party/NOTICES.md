# Third-party notices and licence compliance

> ## **LICENCE COMPLIANCE IS MANDATORY.**
>
> Every line of code, data file or asset borrowed from another project must have a licence
> that permits use in this GPL-3.0-or-later repository. The copyright notice and permission
> notice must travel with the borrowed work. If a project has no licence, **do not copy its
> code or content**: read it to learn the behaviour and write our own implementation.
>
> Every import is recorded in this file, in the commit message, and in the source header.
> `CONTRIBUTING.md` makes this the first rule of the project.

This project is distributed as a whole under **GPL-3.0-or-later**. The components below remain
under their own licences; the GPL applies to the combined work, not as a replacement for
those notices.

## Components whose code or data is used

Only projects something was actually taken from are listed. "Where it is now" names the
files in this repository; the upstream file is named so a port can be re-checked.

| Project | Licence | What was taken, and where it is now |
|---|---|---|
| [EpicMorg/Hammer-MCP](https://github.com/EpicMorg/Hammer-MCP) | [MIT](licenses/hammer-mcp-epicmorg-MIT.txt) | **The live Hammer shell channel** — `Worldcraft_ShellMessageWnd`, `WM_COPYDATA` command grammar, `WM_COMMAND` menu ids, session/`mapversion` handling and process/window discovery (`src/hammer/python/hammer_live.py`, `src/hammer/typescript/tools/hammerlive.ts`). **Autosave locations and matching** — Hammer++'s `AutosaveDir`, the registry keys stock Hammer uses, `originalname` (`src/maps/typescript/game/autosave.ts`). **Run Map sequence formats** — the 804-byte binary command record and the KeyValues variant (`src/maps/typescript/compile/sequences.ts`). **VMT parsing behaviour** — case-insensitive parameters, blocks kept as blocks, a missing closing brace repaired (`src/formats/typescript/formats/vmt.ts`). **The Hammer build registry** — `src/hammer/data/hammers.json`, read at runtime to identify an editor by its DLL hash. **Soundscript resolution behaviour** — the manifest's `*_file` entries, `#base`, sound characters and wave-existence checks (`src/audio/python/soundscripts.py`). |
| [Sycatle/hammer-mcp](https://github.com/Sycatle/hammer-mcp) | [MIT](licenses/hammer-mcp-sycatle-MIT.txt) | The code this repository grew out of. The portions of that tree that survive are the VMF/BSP readers and writers, the compile pipeline, the measurement and render modules, and the tool contracts. Provenance and the change of licence are in [`NOTICE`](NOTICE). |
| [craftablescience/sourcepp](https://github.com/craftablescience/sourcepp) | [MIT](licenses/sourcepp-MIT.txt) | **The VTF `IMAGE_FORMAT_*` table** (`vtfpp/ImageFormats.h` → `src/textures/typescript/bsp/vtf.ts`). **The VPK directory layout** (`vpkpp/format/VPK.cpp` → `src/formats/typescript/formats/vpk.ts`). **The MDL layout** — attachments, body parts, hitbox sets and the 68-byte L4D2 hitbox (`mdlpp/structs/MDL.h` → `src/assets/python/content.py`). **The Source LZMA lump framing** — signature, sizes and properties (`sourcepp/compression/LZMA.cpp` → `src/maps/python/lzma_codec.py`). The DXT encoder is an independent implementation from the S3TC block format, not a port. These are translations of specific files, not a copy of the library: the C++ tree is no longer in the repository. |

### Code that was rewritten, not vendored

The C++ and C# trees that were briefly vendored were **removed on 2026-11-19**. Every
capability the toolkit exposes is implemented in TypeScript, Python or PowerShell, and the
remaining source trees are none of them.

That does not erase the notices above. A translation is a derivative work: the three
sourcepp-derived files named in the table, and the shell-channel port from EpicMorg, still
carry the copyright and permission notices because their logic came from those projects.
Removing the upstream tree removes the copy, not the obligation.

reading, writing and packing are this project's own TypeScript implementation; model
compilation is driven through the game's `studiomdl` (and, optionally, a user-installed

### Licence texts

The full text of each licence travels here, one file per project, under `licenses/`:

| File | Work |
|---|---|
| `licenses/hammer-mcp-epicmorg-MIT.txt` | EpicMorg/Hammer-MCP, © 2026 EpicMorg |
| `licenses/hammer-mcp-sycatle-MIT.txt` | Sycatle/hammer-mcp, © 2026 Project Society Studio |
| `licenses/sourcepp-MIT.txt` | craftablescience/sourcepp, © 2023 Laura Lewis |

MIT requires the copyright line **and** the permission notice to travel with every copy of
the software, so each file contains both, verbatim. Nothing is relicensed by the GPL: the
GPL applies to the combined work, and a recipient may still exercise the MIT permissions on
the MIT portions.

### Runtime dependencies are not listed here

Python packages installed from `requirements.txt`, and npm packages, are dependencies rather
than borrowed code: they are not vendored, not modified and not redistributed by this
project. Their licences ship with the package and are recorded by the package manager. This
file is for what was taken **into the source tree**.

## No source trees are kept

Nothing from another project is vendored in this repository. What is used has been ported
into `src/`, tested, and is owned here — the table above says which upstream file each port
is based on. A parked copy of someone else's tree is not integration: it drifts, it is never
compiled, and it blurs what this project actually is.

## Checklist for a new import

1. **Licence first.** Identify the licence and the exact copyright holder from the
   repository's `LICENSE`. A repository with no licence is **all rights reserved** by
   default.
2. **Compatible with GPL-3.0-or-later.** MIT, BSD, Apache-2.0 and GPL-3.0 are; GPL-2.0-only,
   proprietary and unlicensed code are not.
3. **Permission notice.** Add `licenses/<work>-<SPDX>.txt` with the verbatim text and the
   copyright line, and link it from the table above.
4. **Source header.** Any ported file starts with a comment naming the upstream project, the
   licence and the fact that it was modified.
5. **Commit message.** Say what was taken, from which repository and commit, and that the
   licence was checked.
6. **No silent relicensing.** The imported part stays under its own licence; this project's
   GPL-3.0-or-later applies to the combined work.
7. **No code without a licence.** Use it as a reference, write the implementation, and do not
   add the file.
8. **Record it here.** A component missing from this file is a compliance defect, even if the
   code is correct.

If you are unsure, stop before the commit. A missing feature is recoverable; a licence
violation is not.
