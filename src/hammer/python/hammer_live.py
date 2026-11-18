"""Live Hammer / Hammer++ shell channel.

Portions ported from Hammer-MCP (https://github.com/EpicMorg/Hammer-MCP),
MIT License, Copyright (c) 2026 EpicMorg. Adapted to Python/ctypes for this project.
The full notice is in third_party/NOTICES.md.

Hammer has a hidden window named ``Worldcraft_ShellMessageWnd``. Sending it a
``WM_COPYDATA`` message with an ANSI text command creates/deletes point entities and sets
keyvalues in the map that is open in the editor. ``WM_COMMAND`` on the editor's main window
runs menu commands (save, undo, redo, Run Map, Check for Problems).

This module only touches the editor process. It never writes into a game process.
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import hashlib
import json
import re
from pathlib import Path
from typing import Any

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

WM_COPYDATA = 0x004A
WM_COMMAND = 0x0111
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
SHELL_CLASS = "Worldcraft_ShellMessageWnd"

LRESULT = ctypes.c_ssize_t
WNDENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)


class COPYDATASTRUCT(ctypes.Structure):
    _fields_ = [
        ("dwData", ctypes.c_size_t),
        ("cbData", wt.DWORD),
        ("lpData", ctypes.c_void_p),
    ]


user32.FindWindowW.argtypes = [wt.LPCWSTR, wt.LPCWSTR]
user32.FindWindowW.restype = wt.HWND
user32.FindWindowExW.argtypes = [wt.HWND, wt.HWND, wt.LPCWSTR, wt.LPCWSTR]
user32.FindWindowExW.restype = wt.HWND
user32.SendMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.SendMessageW.restype = LRESULT
user32.PostMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.PostMessageW.restype = wt.BOOL
user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
user32.GetWindowThreadProcessId.restype = wt.DWORD
user32.EnumWindows.argtypes = [WNDENUMPROC, wt.LPARAM]
user32.EnumWindows.restype = wt.BOOL
user32.IsWindowVisible.argtypes = [wt.HWND]
user32.IsWindowVisible.restype = wt.BOOL
user32.GetWindowTextLengthW.argtypes = [wt.HWND]
user32.GetWindowTextLengthW.restype = ctypes.c_int
user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int

kernel32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
kernel32.OpenProcess.restype = wt.HANDLE
kernel32.QueryFullProcessImageNameW.argtypes = [
    wt.HANDLE,
    wt.DWORD,
    wt.LPWSTR,
    ctypes.POINTER(wt.DWORD),
]
kernel32.QueryFullProcessImageNameW.restype = wt.BOOL
kernel32.CloseHandle.argtypes = [wt.HANDLE]
kernel32.CloseHandle.restype = wt.BOOL


def _pid_of(hwnd: int) -> int:
    pid = wt.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return int(pid.value)


def _exe_of(pid: int) -> str | None:
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return None
    try:
        size = wt.DWORD(2048)
        buf = ctypes.create_unicode_buffer(size.value)
        if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return buf.value
        return None
    finally:
        kernel32.CloseHandle(handle)


def _windows_of(pid: int) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []

    @WNDENUMPROC
    def callback(hwnd: int, _lparam: int) -> bool:
        if _pid_of(hwnd) != pid or not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        result.append({"hwnd": int(hwnd), "title": buf.value})
        return True

    user32.EnumWindows(callback, 0)
    return result


def _shell_windows() -> list[tuple[int, int]]:
    """(hwnd, pid) for every running editor shell channel."""
    found: list[tuple[int, int]] = []
    after = 0
    while True:
        hwnd = user32.FindWindowExW(0, after, SHELL_CLASS, SHELL_CLASS)
        if not hwnd:
            break
        found.append((int(hwnd), _pid_of(hwnd)))
        after = hwnd
    return found


def _open_map(titles: list[str]) -> str | None:
    for title in titles:
        match = re.search(r"\[([^\]]+?\.vmf)(?:\s*-[^\]]*)?\]", title, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


_REGISTRY_PATH = (
    Path(__file__).resolve().parents[2] / "hammer" / "csharp" / "registry" / "hammers.json"
)
_registry: dict[str, dict[str, Any]] | None = None


def _load_registry() -> dict[str, dict[str, Any]]:
    """Hammers the upstream registry knows, keyed by the SHA-256 of their editor DLL.

    The file is JSON with `//` comments and a trailing comma, so it is cleaned before
    `json.loads`. A missing or unreadable registry is not an error: identification is a
    bonus, and `hammer_status` still reports the process, the windows and the open map.
    """
    global _registry
    if _registry is not None:
        return _registry
    try:
        text = _REGISTRY_PATH.read_text(encoding="utf-8")
    except OSError:
        _registry = {}
        return _registry
    text = re.sub(r"(?m)^\s*//.*$", "", text)
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        _registry = {}
        return _registry
    found: dict[str, dict[str, Any]] = {}
    for build in data.get("builds", []):
        digest = (build.get("match") or {}).get("sha256")
        if isinstance(digest, str) and digest:
            found[digest.lower()] = build
    _registry = found
    return _registry


def _identify(exe: str | None) -> dict[str, Any] | None:
    """The registry entry for this editor's DLL, or None.

    The DLL is not always beside the executable: Hammer++ for L4D2 keeps it in
    `bin/hammerplusplus/bin/` while `hammerplusplus.exe` is in `bin/`. The candidate list is
    therefore the shapes the shipped layouts use, not one guess.
    """
    registry = _load_registry()
    if not exe or not registry:
        return None
    base = Path(exe).parent
    names = {
        (build.get("match") or {}).get("dll")
        for build in registry.values()
        if (build.get("match") or {}).get("dll")
    }
    for name in names:
        for root in (base, base / "hammerplusplus" / "bin", base / "hammerplusplus", base / "bin"):
            candidate = root / str(name)
            try:
                digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
            except OSError:
                continue
            build = registry.get(digest)
            if build:
                return {
                    "id": build.get("id"),
                    "family": build.get("family"),
                    "branch": build.get("branch"),
                    "build": build.get("build"),
                    "arch": build.get("arch"),
                    "shell": (build.get("shell") or {}).get("present"),
                }
    return None


def _modified(titles: list[str]) -> bool | None:
    """Whether the open map has unsaved changes, when the editor says so.

    Hammer appends `*` to the map name inside the title's brackets. Not every build does:
    Hammer++ 8873 x86 was measured on 18/11/2026 with an edited map open and its title stayed
    `[map.vmf - Textured Shaded]`. So `True` is proof of unsaved changes and `None` means the
    title carries no marker — never "the map is saved". A caller that needs certainty should
    compare the saved `.vmf` with the editor's map version, not trust a missing asterisk.
    """
    for title in titles:
        match = re.search(r"\[([^\]]+?\.vmf[^\]]*)\]", title, re.IGNORECASE)
        if match:
            return True if "*" in match.group(1) else None
    return None


def _editor(pid: int, shell: int) -> dict[str, Any]:
    windows = _windows_of(pid)
    main = next((w for w in windows if "[" in w["title"]), windows[0] if windows else None)
    titles = [w["title"] for w in windows]
    exe = _exe_of(pid)
    return {
        "pid": pid,
        "name": Path(exe).stem if exe else None,
        "exe": exe,
        "shellWindow": shell,
        "mainWindow": main["hwnd"] if main else 0,
        "hasShell": bool(shell),
        "titles": titles,
        "openMap": _open_map(titles),
        "modified": _modified(titles),
        "build": _identify(exe),
    }


def status() -> dict[str, Any]:
    owners = _shell_windows()
    seen: dict[int, int] = {}
    for hwnd, pid in owners:
        seen.setdefault(pid, hwnd)
    editors = [_editor(pid, hwnd) for pid, hwnd in seen.items()]
    # Include known editor processes that have no shell channel yet, so a caller can see
    # "Hammer is open but this build has no shell" instead of "nothing is running".
    known = {"hammer", "hammerplusplus", "wc", "jack", "jackhammer", "sledge.editor"}
    for pid in _process_ids():
        if pid in seen:
            continue
        exe = _exe_of(pid)
        name = Path(exe).stem.lower() if exe else ""
        if name not in known:
            continue
        editors.append(_editor(pid, 0))
    return {"count": len(editors), "editors": editors}


def _process_ids() -> list[int]:
    """PIDs of running processes, from tasklist (no psutil dependency)."""
    try:
        import subprocess

        out = subprocess.check_output(
            ["tasklist", "/FO", "CSV", "/NH"], text=True, encoding="mbcs", errors="replace"
        )
    except Exception:
        return []
    pids: list[int] = []
    for line in out.splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) >= 2:
            try:
                pids.append(int(parts[1]))
            except ValueError:
                continue
    return pids


def send(pid: int, command: str) -> dict[str, Any]:
    shell = next((hwnd for hwnd, owner in _shell_windows() if owner == pid), 0)
    if not shell:
        return {"accepted": False, "reason": "no shell channel for this process"}
    data = command.encode("mbcs", "replace") + b"\0"
    buffer = ctypes.create_string_buffer(data)
    cds = COPYDATASTRUCT(
        dwData=0,
        cbData=len(data),
        lpData=ctypes.cast(buffer, ctypes.c_void_p),
    )
    result = user32.SendMessageW(
        shell,
        WM_COPYDATA,
        0,
        ctypes.cast(ctypes.byref(cds), ctypes.c_void_p).value or 0,
    )
    return {"accepted": bool(result), "command": command}


def menu(pid: int, command_id: int) -> dict[str, Any]:
    editor = next((e for e in status()["editors"] if e["pid"] == pid), None)
    if not editor or not editor["mainWindow"]:
        return {"posted": False, "reason": "no main window for this process"}
    ok = user32.PostMessageW(editor["mainWindow"], WM_COMMAND, command_id, 0)
    return {"posted": bool(ok), "commandId": command_id}


def _map_version(vmf: str) -> int:
    try:
        text = Path(vmf).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return 0
    match = re.search(r'"mapversion"\s+"(\d+)"', text, re.IGNORECASE)
    return int(match.group(1)) if match else 0


def batch(pid: int, vmf: str, commands: list[str]) -> dict[str, Any]:
    """Open a shell session for the saved VMF, send each command, close the session."""
    stem = Path(vmf).stem
    version = _map_version(vmf)
    send(pid, "session_end")
    accepted_version: int | None = None
    for offset in (0, 1, -1):
        candidate = version + offset
        reply = send(pid, f"session_begin {stem} {candidate}")
        if reply["accepted"]:
            accepted_version = candidate
            break
    if accepted_version is None:
        return {
            "session": False,
            "reason": "Hammer refused every session_begin version; is this VMF the open map?",
            "results": [],
        }
    results = []
    try:
        for command in commands:
            results.append(send(pid, command))
    finally:
        send(pid, "session_end")
    return {
        "session": True,
        "acceptedVersion": accepted_version,
        "results": results,
        "accepted": sum(1 for r in results if r["accepted"]),
        "rejected": sum(1 for r in results if not r["accepted"]),
    }
