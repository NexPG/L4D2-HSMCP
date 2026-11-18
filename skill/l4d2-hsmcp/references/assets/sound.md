# Sound in an L4D2 addon

The toolkit reads a WAV, tells you whether L4D2 will decode it, and converts it when it will
not. It does not mix, master or generate audio; that stays in a sound editor.

## What L4D2 decodes

- **16-bit PCM**, mono or stereo, at **22050 or 44100 Hz**. That is what `read_wav` calls
  `gameReady: true`.
- 8-bit, 24-bit, float and compressed WAVs are decoded by some Source builds and not by
  others. Treat them as a bug report waiting to happen: `convert_wav` writes 16-bit PCM.
- Mono is the safe choice for a point sound; stereo doubles the size and the engine may
  collapse it anyway for a positional sound.

## Where it goes

| Thing | Path inside the addon |
|---|---|
| The wave | `sound/<folder>/<name>.wav` |
| A soundscript | `scripts/<name>.txt` |
| A soundscape | `scripts/soundscapes_<name>.txt` |

A soundscript names the wave and the playback properties:

```
"SoundData"
{
    "MyAddon.Tone"
    {
        "channel"    "CHAN_STATIC"
        "volume"     "1.0"
        "soundlevel" "75dB"
        "pitch"      "100"
        "wave"       "myaddon/tone.wav"
    }
}
```

The `wave` path is relative to `sound/`. An entity then refers to the sound by the
soundscript name (`MyAddon.Tone`) or, for a simple one-shot, by the wave path without the
`sound/` prefix and the `.wav` suffix.

## The tools

| Job | Tool |
|---|---|
| Is this WAV safe for L4D2? | `read_wav` — format, channels, rate, duration, loop, `gameReady` |
| Make it safe | `convert_wav` — resample, mix to mono/stereo, write 16-bit PCM, read it back |
| Ship it | `run_vpk_build` / `run_vpk_pack` with the `sound/` and `scripts/` trees staged |

`read_wav` reports a `smpl` loop chunk when one exists, but `convert_wav` does not write one:
looping in L4D2 is a property of the soundscript or of the entity playing it, not of the
file. A converted file keeps its samples and loses a chunk the game does not read.

## Checking it

1. `read_wav` — `gameReady: true`, and the duration is what you expect.
2. `read_vpk` after packing — the `sound/` and `scripts/` entries are present.
3. `run_map_test` — an `ambient_generic` or a scripted sound is audible; the console shows
   `Failed to load sound` with the exact path it tried, which is the fastest way to find a
   case or prefix mistake.
