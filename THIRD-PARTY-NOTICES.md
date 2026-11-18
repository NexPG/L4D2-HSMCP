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
| [EpicMorg/Hammer-MCP](https://github.com/EpicMorg/Hammer-MCP) | MIT | The live Hammer shell-channel protocol: `Worldcraft_ShellMessageWnd`, `WM_COPYDATA` text commands, `WM_COMMAND` menu ids, session/version handling, process and window discovery. Ported and adapted to `sidecar/hammer_live.py` and `src/tools/hammerlive.ts`. |
| [Sycatle/hammer-mcp](https://github.com/Sycatle/hammer-mcp) | MIT | The original project this repository grew out of; the parts of that tree that survive here. See `NOTICE`. |
| [TeamSpen210/srctools](https://github.com/TeamSpen210/srctools) | MIT (excluding `libsquish/`, which has its own licence) | The Python sidecar's BSP, VPK, VTF, FGD and VMF readers. Installed as a dependency, not vendored as source. |
| [craftablescience/sourcepp](https://github.com/craftablescience/sourcepp) | MIT | Source format libraries vendored in `vendor/sourcepp/`. The VTF image-format table in `src/bsp/vtf.ts` is taken from `vtfpp/ImageFormats.h`; VPK, BSP and MDL structure come from `vpkpp`, `bsppp` and `mdlpp`. |

### MIT licence text

The following notice applies to the MIT-licensed components above. The copyright lines are
kept separately because they are different works.

```
MIT License

Copyright (c) 2026 EpicMorg
Copyright (c) 2026 Project Society Studio
Copyright (c) 2023 Laura Lewis
Copyright (c) 2022 Laura Lewis
Copyright (c) 2021 Spencer Brown

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`srctools` also contains `libsquish/` under its own licence; this project does not copy or
modify that directory and uses the installed package as a whole.

### GPL-3.0 components

same licence as this repository, so combining and porting are permitted. Its full licence
it, the ported file carries a header naming the upstream project and the change, and this
table is updated in the same commit.

### Vendored trees that are not built

compiled by this project's build and are not included in the published npm package, which
ships `dist/` alone. `vendor/README.md` records the exact commands for building them and
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
2. **Permission notice.** Copy the full licence text or keep the upstream `LICENSE` file, and
   add the copyright line to this document.
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
