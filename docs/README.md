# Documentation

The human-facing documentation. The agent-facing version lives in
[`skill/l4d2-hsmcp/`](../skill/l4d2-hsmcp/); this tree is for people reading the repository.

| Directory | What it holds |
|---|---|
| [`campaign/`](campaign/) | the campaign contract: mission file, safe rooms, transitions, finale, deployment |
| [`map/`](map/) | map and engine reference: VMF/BSP architecture, compiling, formats, measurements |
| [`reference/`](reference/) | project reference: the tool parity table, the Hammer++ and L4D2 complete references, the limits, and the inherited gate history |
| [`media/`](media/) | illustrations the README and documentation link to, with their origin |

Start with [`campaign/overview.md`](campaign/overview.md) if you are building a campaign.

Research **logs** are kept in the development diary (`.develop-diary/04-log/`), not in this
tree. `reference/` holds the manuals distilled from them.
