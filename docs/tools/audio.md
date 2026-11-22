# Audio

7 tools: soundscripts, soundscapes and WAV.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Soundscripts and soundscapes

| Tool | What it does |
|---|---|
| `check_sound` | Checks a .wav or a soundscript. A WAV must decode and be 16-bit PCM at 22050/44100 Hz, mono or stereo; a compressed or 8-bit wave is named. A soundscript is read through the same reader as `read_soundscript`, and every sound whose wave file is absent is a warning. Needs the Python sidecar for the actual read. |
| `read_soundscape` | Reads soundscape definitions from one file or from the game's scripts/soundscapes_*.txt. |
| `read_soundscript` | Lists named sounds and the wave each resolves to, from one loose soundscript or from the whole game through scripts/game_sounds_manifest.txt (including #base/#include). |
| `write_soundscape` | Builds one soundscape and appends it to a .txt without rewriting the rest of the file. |
| `write_soundscript` | Adds one sound block (`name`, `channel`, `wave` or `waves` as a random pick, volume, soundlevel, pitch) to a soundscript. |

## WAV

| Tool | What it does |
|---|---|
| `convert_wav` | Converts a WAV to the shape L4D2 expects: 16-bit PCM, mono or stereo, at a chosen rate (22050 or 44100 are the safe ones). |
| `read_wav` | Reads a WAV's format and content: encoding, channels, sample rate, bit depth, frames, duration, byte size, the chunk list and the `smpl` loop when one is present. |
