# Changelog

Versions follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`, with a
prerelease suffix (`-alpha`, `-beta`) while the toolchain is still being proven on the
target game. A version is bumped in the same commit as the change it describes, together
with a line here.

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
