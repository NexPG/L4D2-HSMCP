"""Reading a .vmf the way Valve writes it.

Two details are easy to get wrong and both are invisible until a map loses a keyvalue:

- **Encoding.** Hammer writes the system codepage; on a Russian install that is cp1251,
  which is what srctools assumes when it is handed a path. A genuine UTF-8 map exists too,
  so try UTF-8 first and fall back to cp1251 -- ASCII decodes identically either way.
- **Conditional flags.** Valve prefixes every flag with ``$`` (``[$WIN32]``). srctools'
  evaluator does not know that prefix, and an unknown flag is false, so it drops
  ``[$WIN32]`` keys and keeps ``[!$WIN32]`` ones -- the opposite of the engine on a PC.
  Strip the ``$`` outside quoted strings before parsing.

Everything that reads a VMF through srctools goes through here so the two fixes cannot
drift apart again.
"""

from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any

_QUOTED = re.compile(r'("[^"]*")')
_BRACKET = re.compile(r"\[([^\]]*)\]")
_DOLLAR = re.compile(r"\$([A-Za-z0-9_]+)")


def read_vmf_text(path: str) -> str:
    """Decode a VMF without assuming one codepage."""
    raw = Path(path).read_bytes()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1251", errors="replace")


def strip_valve_flag_dollars(text: str) -> str:
    """Turn ``[$WIN32]`` into ``[WIN32]``, leaving quoted strings alone."""

    def fix(chunk: str) -> str:
        if chunk.startswith('"'):
            return chunk
        return _BRACKET.sub(
            lambda match: "[" + _DOLLAR.sub(r"\1", match.group(1)) + "]",
            chunk,
        )

    return "".join(fix(part) for part in _QUOTED.split(text))


def parse_vmf_keyvalues(path: str) -> Any:
    """Parse a VMF file into srctools ``Keyvalues`` with flags resolved for a PC."""
    from srctools import Keyvalues

    return Keyvalues.parse(io.StringIO(strip_valve_flag_dollars(read_vmf_text(path))))
