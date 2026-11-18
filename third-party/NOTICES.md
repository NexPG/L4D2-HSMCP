# Third-party notices and licence compliance

> ## **LICENCE COMPLIANCE IS MANDATORY.**
>
> Every line of code, data file or asset borrowed from another project must have a licence
> that permits use in this GPL-3.0-only repository. The copyright notice and permission
> notice must travel with the borrowed work. If a project has no licence, **do not copy its
> code or content** — read it as a reference and write our own implementation. If the licence
> is unclear, stop and ask; do not guess.
>
> Every import is recorded in this file, in the commit message, and in the source header.
> `CONTRIBUTING.md` makes this the first rule of the project.

This project is distributed as a whole under **GPL-3.0-only**. The components below remain
under their own licences; the GPL applies to the combined work, not as a replacement for
those notices.

## Components whose code or data is used

| Project | Licence | What this project uses |
|---|---|---|
| [EpicMorg/Hammer-MCP](https://github.com/EpicMorg/Hammer-MCP) | [MIT](licenses/hammer-mcp-epicmorg-MIT.txt) | The live Hammer shell-channel protocol: `Worldcraft_ShellMessageWnd`, `WM_COPYDATA` text commands, `WM_COMMAND` menu ids, session/version handling, process and window discovery. Ported and adapted to `sidecar/hammer_live.py` and `src/tools/hammerlive.ts`. |
| [Sycatle/hammer-mcp](https://github.com/Sycatle/hammer-mcp) | [MIT](licenses/hammer-mcp-sycatle-MIT.txt) | The original project this repository grew out of; the parts of that tree that survive here. See `NOTICE`. |
| [TeamSpen210/srctools](https://github.com/TeamSpen210/srctools) | [MIT](licenses/srctools-MIT.txt) (excluding `libsquish/`, which has its own) | The Python sidecar's BSP, VPK, VTF, FGD and VMF readers. Installed as a dependency, not vendored as source. |
| [craftablescience/sourcepp](https://github.com/craftablescience/sourcepp) | [MIT](licenses/sourcepp-MIT.txt) | Source format libraries vendored in `src/formats/cpp/sourcepp/`. The VTF image-format table in `src/bsp/vtf.ts` is taken from `vtfpp/ImageFormats.h`; VPK, BSP and MDL structure come from `vpkpp`, `bsppp` and `mdlpp`. |

### Licence texts

The full text of each licence travels here, one file per project, under `licenses/`:

| File | Work |
|---|---|
| `licenses/hammer-mcp-epicmorg-MIT.txt` | EpicMorg/Hammer-MCP, © 2026 EpicMorg |
| `licenses/hammer-mcp-sycatle-MIT.txt` | Sycatle/hammer-mcp, © 2026 Project Society Studio |
| `licenses/sourcepp-MIT.txt` | craftablescience/sourcepp, © 2023 Laura Lewis |
| `licenses/srctools-MIT.txt` | TeamSpen210/srctools, © 2021 Spencer Brown |

MIT requires the copyright line **and** the permission notice to travel with every copy of
the software, so each MIT file contains both, verbatim. Nothing is relicensed by the GPL:
the GPL applies to the combined work, and a recipient may still exercise the MIT permissions
on the MIT portions.

`srctools` also contains `libsquish/` under its own licence; this project does not copy or
modify that directory and uses the installed package as a whole.

### GPL-3.0 components

same licence as this repository, so combining and porting are permitted. Its full licence
it, the ported file carries a header naming the upstream project and the change, and this
table is updated in the same commit.

### Vendored trees that are not built

compiled by this project's build and are not included in the published npm package, which
ships `dist/` alone. `../src/README.md` records the exact commands for building them and
the submodules CMake fetches at configure time.

## Projects reviewed but not copied

These were examined during the 2026 upstream-intake pass. **No code or content from them is
in this tree.** They are listed so a future contributor does not repeat the audit and does
not accidentally assume a licence that is not there.

| Project | Licence | Status |
|---|---|---|
| [Mrfunreal/L4D2-FGD-Edits](https://github.com/Mrfunreal/L4D2-FGD-Edits) | No licence file found | Reference only. No FGD, model, texture or script is copied. The toolkit can load a user-installed FGD through the `fgd` argument of `read_fgd_class` / `read_vmf_lint`; the file stays on the user's disk. |
| [Mrfunreal/L4D2_Navmesh_CFG](https://github.com/Mrfunreal/L4D2_Navmesh_CFG) | No licence file found | Reference for nav console commands; no `.cfg` copied. |
| [Mrfunreal/Various_Scripts](https://github.com/Mrfunreal/Various_Scripts) | No licence file found | Reference only; no scripts copied. |
| [Mrfunreal/-L4D2_Weapon_Viewmodel_QC_Prefabs](https://github.com/Mrfunreal/-L4D2_Weapon_Viewmodel_QC_Prefabs) | No licence file found | Reference only; no QC prefab copied. |
| [Mrfunreal/L4D2_Player_Extra_Files](https://github.com/Mrfunreal/L4D2_Player_Extra_Files) | No licence file found | Reference only; no model, QCI or SMD copied. |
| [justin-chellah/navmesh-lib](https://github.com/justin-chellah/navmesh-lib) | GPL-3.0 | Reference only. A SourceMod plugin that reads nav data out of a running server's memory through gamedata offsets; it never touches `.nav` files, which is what this project works with. |
| [justin-chellah/survivor-bot-nav-fixes](https://github.com/justin-chellah/survivor-bot-nav-fixes) | GPL-3.0 | Reference for the L4D2 nav attribute names and bits. Those values come from Valve's public `nav.h`, so our implementation is written from the header, not from this plugin. |
| [Zolfyyy/sourcepawn-navmesh](https://github.com/Zolfyyy/sourcepawn-navmesh) | GPL-3.0 | Reference only. Its `.nav` parser is credited to Anthony Iacono's `War3SourceV2/Nav`, which has **no licence of any kind** (`/license` returns 404), so the wrapper's GPL cannot cover that code. Our nav reader is written from the format itself. |

A project without a licence is **all rights reserved** by default. Reading it to learn a
protocol or a command name is not the same as copying its expression; when in doubt, write
the implementation from the observed behaviour and cite the project as a reference.

## Checklist for a new import

1. **Licence first.** Identify the licence and the exact copyright holder. Check that it is
   compatible with GPL-3.0-only (MIT, BSD, Apache-2.0 and GPL-3.0 are; GPL-2.0-only and
   "all rights reserved" are not).
2. **Permission notice.** Add `licenses/<work>-<SPDX>.txt` with the verbatim licence text and
   the copyright line, keep the upstream `LICENSE` next to the source, and link both from
   `README.md` and from this file.
3. **Source header.** Any ported file starts with a comment naming the upstream project, the
   licence and the fact that it was modified for this repository.
4. **Commit message.** Say what was taken, from which repository and commit, and that the
   licence was checked. Use `(cherry picked from commit ...)` when the original commit is
   the source.
5. **No silent relicensing.** The imported part stays under its own licence; this project's
   GPL-3.0-only applies to the combined work.
6. **No code without a licence.** If there is no licence, use it as a reference only, or ask
   the author for permission.
7. **Record it here.** A component missing from this file is a compliance defect, even if
   the code is correct.

If you are unsure, stop before the commit. A missing feature is recoverable; a licence
violation is not.
