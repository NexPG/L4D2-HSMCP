# Choreography and scenes

3 tools: VCD timelines, actor channels, events and the scenes.image summary.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Scenes and scene images

| Tool | What it does |
|---|---|
| `edit_choreo_events` | Edits a text .vcd choreography timeline: change the start, end and parameter slots of existing events, remove one, or add a speak/firetrigger/stoppoint event to an existing actor channel. |
| `read_choreo` | Reads a text VCD choreography scene: map name, FPS, duration, every event on the timeline (type, start/end, parameters, flags), the actor/channel tree, and the sounds it uses. |
| `read_scenes_image` | Reads `scenes/scenes.image`: one entry per choreo scene, keyed by CRC, with its duration, the end of the last spoken line and the sounds it uses. |
