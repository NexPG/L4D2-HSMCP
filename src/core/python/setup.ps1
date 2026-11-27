# Creates the sidecar's virtualenv and installs its pinned dependencies.
#
# Windows only, like the rest of this fork. The venv lives in the repository's state
# directory (`.hammer-mcp/sidecar-venv`), not beside this script: it is machine-specific
# build output and the state directory is already ignored by git.
#
# Safe to re-run: it recreates nothing that already matches.
#
# -Models adds the optional photo-to-texture stack (Pillow, OpenCV, MediaPipe, rembg).
# It is not installed by default because it is several hundred MB and only needed for
# model-skin work.
param([switch]$Models)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoOverride = if ($env:L4D2_HSMCP_REPO) { $env:L4D2_HSMCP_REPO } elseif ($env:HAMMER_MCP_REPO) { $env:HAMMER_MCP_REPO } else { $null }
$repo = if ($repoOverride) { $repoOverride } else { Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $here)) }
$venv = Join-Path $repo ".hammer-mcp\sidecar-venv"
$python = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $python)) {
  Write-Host "creating venv: $venv"
  $base = if ($env:PYTHON) { $env:PYTHON } else { "py" }
  if ($base -eq "py") {
    & py -3 -m venv $venv
  } else {
    & $base -m venv $venv
  }
}

& $python -m pip install --quiet --upgrade pip
& $python -m pip install --quiet -r (Join-Path $here "requirements.txt")
if ($Models) {
  Write-Host "installing optional photo-to-texture stack"
  & $python -m pip install --quiet -r (Join-Path $here "requirements-models.txt")
}

Write-Host -NoNewline "sidecar ready: "
& $python (Join-Path $here "main.py") health
