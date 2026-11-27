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
| Register it | `write_soundscript` — one block, appended to an existing script |
| Build the ambient bed | `write_soundscape` — looping beds, random one-shots, children, DSP |
| Check an existing scape | `read_soundscape` — every wave under `sound/`, from one file or the game |
| Check a name or the whole game | `read_soundscript` — channel, waves, `#base`, and whether each wave exists |
| Ship it | `run_vpk_build` / `run_vpk_pack` with the `sound/` and `scripts/` trees staged |

`read_soundscript` resolves the manifest and every `#base`, so a name the game already
defines is found before an addon shadows it. It reports the first definition that wins and
the later ones ignored, and checks each `wave` under `sound/`. The writer appends rather
than re-exporting, so comments and other entries survive.

`read_wav` reports a `smpl` loop chunk when one exists, and `convert_wav` scales it to the
new rate and writes it back. L4D2 gameplay loops are usually a property of the soundscript
or the entity playing the sound, but keeping the chunk means a converted file does not lose
information. `keepLoop: false` drops it deliberately.

## Soundscapes

A soundscape is the ambient mix an `env_soundscape` entity selects: a looping bed, random
one-shots, child scapes and a DSP preset. It lives in `scripts/soundscapes_<name>.txt` and
uses raw wave paths, not soundscript names.

The FGD lists five values for `env_soundscape.soundscape` (`Nothing`, `Automatic`,
`Automatic_Dialog`, `GenericIndoor`, `GenericOutdoor`). That list is convenience, not a closed
enum: any name defined in `scripts/soundscapes_*.txt` is valid, including an add-on's own
`MyCampaign.Rain`. `read_vmf_lint` treats the key as open-ended for `env_soundscape` classes;
before that it flagged every custom scape as a value the engine would ignore.

`write_soundscape` appends one definition, refuses a duplicate name, and checks every wave
when the game directory is resolved. `read_soundscape` reads one file or all
`soundscapes_*.txt` in the game, follows child names, and reports waves this install does
not have. Point an `env_soundscape` at the scape name; `env_soundscape_proxy` forwards from
another entity.

## Two rooms, one bed: the map-level pattern

A map usually needs an exterior bed and an interior bed, not one scape for everything. Use
two `env_soundscape` entities with different `soundscape` names and radii, and a
`env_soundscape_proxy` where the same bed is reused under another name:

```text
edit_vmf(path, ops: [
  { op: "add", keyvalues: { classname: "env_soundscape", targetname: "scape_out",
    origin: "0 0 64", soundscape: "SantaMonica.Rain", radius: "-1" } },
  { op: "add", keyvalues: { classname: "env_soundscape", targetname: "scape_in",
    origin: "0 0 64", soundscape: "SantaMonica.RainInside", radius: "-1" } },
  { op: "add", keyvalues: { classname: "env_soundscape_proxy", targetname: "scape_proxy",
    origin: "0 0 64", MainSoundscapeName: "scape_out", radius: "512" } },
  { op: "add", keyvalues: { classname: "ambient_music", targetname: "music_cue",
    origin: "0 0 64", message: "Event.MissionStart" } },
  { op: "add", keyvalues: { classname: "sound_mix_layer", targetname: "mix_rain",
    origin: "0 0 0", MixLayerName: "rain", Level: "0.5" } }
])
```

- `radius -1` means the scape is global; a positive radius makes it a local volume.
- `ambient_music` plays a **GameSound** entry (`message`), fired by `PlaySound`; it is not a
  soundscript name.
- `sound_mix_layer` sets a named mix layer; it is a point entity, not a sound.
- Two rooms need two scapes **and** a trigger/volume boundary; the entity radius alone does
  not fade the bed.
- Measured fixture: two `env_soundscape`, one proxy, one `ambient_music` and one
  `sound_mix_layer` compile with no leak. Hearing the mix is still a live test.

## Checking it

1. `read_wav` — `gameReady: true`, and the duration is what you expect.
2. `read_vpk` after packing — the `sound/` and `scripts/` entries are present.
3. `run_map_test` — an `ambient_generic` or a scripted sound is audible; the console shows
   `Failed to load sound` with the exact path it tried, which is the fastest way to find a
   case or prefix mistake.
