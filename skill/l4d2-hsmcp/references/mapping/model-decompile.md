# Decompiling a compiled model

`decompile_model` is the reverse direction: a compiled `.mdl` becomes a QC, a reference SMD,
one animation SMD per decodable sequence, and, when a `.phy` is installed, a collision SMD.
It applies the VVD fixup order and the static-prop axis swap, writes the bind-pose skeleton
and each vertex's bone weights, and derives the collision from the `.phy`: a jointed file
becomes `$collisionjoints` with every solid, its parent, mass, massbias, damping and
`$jointconstrain` limits (so a ragdoll stays a ragdoll), and a single hull becomes
`$collisionmodel`/`$concave`. A single hull's compiler frame follows the first sequence's
root; the pitched-root case is reproduced exactly, and other root poses are reported instead
of being written rotated. The QC also carries what only the compiled model knows:
`$includemodel` entries, `$contents`, `$bbox`/`$cbox`, `$keyvalues` (so `prop_data` and fire
interactions survive), `$ikchain`/`$ikautoplaylock` for the limb chains, and, on request, a
`$definebone` line per bone in the verified `(y, z, x)` order. Sequences whose data lives in
the `.mdl` are decoded frame by frame (raw vectors and quaternions, or the RLE streams) and
written as SMD `time <frame>` blocks with a `$sequence` line at the source fps; the SMD
`time` is a frame number, not seconds. Fade times and `event` lines are written with the
sequence, and a one-SMD clip with an event becomes a `$sequence` block because the one-line
form cannot carry one.

## Contents

- What a decompile writes
- Autolayers and IK rules
- Sequence options
- Weight lists

## What a decompile writes

Every body part's alternatives are written as separate SMDs and a `$bodygroup` block, with
`blank` for an empty value, so a model with several bodygroup values keeps them. Every VTX LOD
becomes its own SMD and a `$lod`/`replacemodel` line at the source switch distance; shadow
LODs use a `$shadowlod` block. Attachments and custom hitbox sets are written as `$attachment` and
`$hboxset`/`$hbox` lines; a hitbox set that studiomdl auto-generated is left out so the next
compile can rebuild it from the mesh. Models with more than one skin family get a
`$texturegroup "skinfamilies"` block built from the MDL's skin table. External `.ani` clips
are decoded, including the frame-by-bone layout; multi-blend sequences become `$sequence`
blocks with one SMD per animation, `blendwidth` and `blend` pose ranges. External clips live in a sibling `.ani`; `read_model_ani` shows its `IDAG` header, block ranges, the clips and sequences each block holds, and range/gap/orphan checks, while `decompile_model` decodes the frames. LOD options are reconstructed from the compiled data: `replacebone` from the per-LOD bone
flags, `replacematerial` from the VTX replacement lists, `facial`/`nofacial` from the strip
group flags, and `removemodel` when a bodygroup model has no geometry at that distance.
`read_model_lods` shows the same options before a decompile. Procedural bones (quat-interp helpers and aim rules) are written to a `_procedural.vrd`
next to the QC and referenced with `$proceduralbones`; `read_model_procedural` shows them.
Jigglebones survive as `$jigglebone` blocks, including the flexible/boing variants and
all constraints (`read_model_jiggle` inspects them). Eyes and mouths are readable (`read_model_eyes`) but not writable: L4D2's studiomdl has no
`$eyeball`/`$eyelid`/`$mouth` command, so a decompile warns that a recompile loses them.
Flex deltas are
written as a `.vta` next to the reference SMD, referenced from a `$model { flexfile ... }`
block: the basis frame lists every fixed LOD-0 vertex, each frame holds the deformed
position/normal, and the QC carries the original `flexcontroller` lines and the rules
rebuilt from the MDL's postfix ops. The delta fields are float16 in the `.mdl`, not
`short / 4096`. `read_vta`/`write_vta` inspect or hand-author the same file and verify a
write by reading it back. A one-frame `$sequence "idle"` is written only when no real sequence can be
decoded. Bodygroup presets are the remaining gap; the tool lists it in `warnings` rather
than pretending the QC is complete. The default target is `<name>_decompiled.mdl`, so a
direct recompile cannot overwrite the source.

## Autolayers and IK rules

Autolayers are written; IK rules only when they are stored in the `.mdl`. Autolayers are common (measured: 310 of the
gambler's 814 sequences, 36 of the hunter's 89) and the decompiler writes them as
`addlayer "<sequence>"` or `blendlayer "<sequence>" <start> <peak> <tail> <end>` with
`xfade`/`spline`/`noblend`/`poseparameter`/`local`, using frames rather than the stored 0..1
phase. Verified by a real compile of `gascan001a`: `gasCan_idle` came back with one autolayer.

IK rules are written **when they are stored in the `.mdl`**, and only then. The record is 152
bytes at `ikruleindex`, relative to the animation descriptor; the QC line carries the chain,
the type (`touch "<bone>"`, `footstep`, `release`, `attachment "<name>"`, `unlatch`), contact,
fake origin/rotation, floor, height, radius, the influence window in frames (wrapped modulo
the last frame with `usesequence`) and the target slot. Verified on `v_rifle`: **44 rules
written, stock `studiomdl` compiles, 60 rules present in the recompiled model** (studiomdl
expands them across the sequences that use the clip).

Most L4D2 character rules live on the other side of the fence: 90 of the hunter's 164 and 990
of the gambler's 2202 animation descriptors point at `animblockikruleindex`, the `.ani` payload,
which this decompiler does not read for rules. The reference decompiler does not either — it
calls its rule reader only for v44 models or `animBlock == 0` — so there is no oracle for the
block layout and the loss is reported rather than guessed. Those rules are counted and named in
a warning;
`read_model_animation` shows the per-sequence counts, so the loss is visible before a compile.
For an aim-matrix-heavy character, treat the decompiled QC as a starting point.
(`walkframe` is not in the sequence descriptor at all; it is a QC option baked into the clips
during compile.)

## Sequence options

Sequence options are written from the flags, with one deliberate exception. `snap`,
`hidden`, `autoplay`, `realtime` and `posecycle` come from the compiled sequence flags and go
into the `$sequence` block. Verified by a real compile of `gascan001a`: `pullpin`/`throw`/
`melee` came back with `STUDIO_SNAP` (0x2) and `a_gasCan_vaims` with `STUDIO_HIDDEN` (0x400).
`delta` is **not** written: the decompiled SMDs are baked frames, while `delta` tells studiomdl
to read them as differences from the reference pose. That model's `gasCan_idle` loses the
`delta` bit on a recompile, and the tool does not pretend otherwise. Autolayers are written: `addlayer`
when the window is empty, otherwise `blendlayer "<sequence>" <start> <peak> <tail> <end>` with
`xfade`/`spline`/`noblend`/`poseparameter`/`local`, converted from the stored 0..1 phase to
frames. A layer that names a sequence the decompile did not write is dropped with a warning —
studiomdl++ aborts the whole model on a dangling layer name. Verified on `gascan001a`
(`gasCan_idle` returned with one autolayer).

## Weight lists

Weight lists are written and verified. Non-default bone weights are common (measured:
35 of the hunter's 89 sequences, 355 of the gambler's 814, 18 of the 36 in
`v_huntingrifle`). The decompiler writes `$weightlist "weights_<sequence>" { "bone" weight ... }`
once per unique list and `weightlist "..."` inside each sequence. A/B on `v_huntingrifle`:
decompile -> compile -> read back gave **35 sequences, 17 with non-default weights** (the source
has 36 sequences and 18; one is skipped by the decompile).

**`activity` needs a weight, or stock studiomdl stops.** A `$sequence` line that ends with
`activity ACT_...` and no number makes stock `studiomdl` print `Line N is incomplete` and
abort — the message names a QC line, not an SMD one, which is why it reads as a mystery. The
decompiler writes the compiled `actweight` after the name (`activity ACT_VM_IDLE_GASCAN 1`)
and comments out a zero weight, which studiomdl also refuses. Verified: `gascan001a` compiles
with stock `studiomdl` after this, and both activities came back with weight 1.

**Weight lists are limited to bones that carry vertices.** Stock `studiomdl` treats a
`$weightlist` entry naming a bone with no mesh vertices as an error (`unknown bone reference`,
aborting the model), even though the name exists in the skeleton: measured on
`v_huntingrifle`, where only 6 of 63 bones are weighted by the mesh, and on the finger bones
Valve's own viewmodel animation uses. The decompiler therefore writes an entry only for a
bone with at least one LOD-0 vertex (`survivor_gambler` has 69 such bones, the hunter mesh 53,
`v_huntingrifle` 6), and drops a list that becomes all-default. After the change both
`gascan001a` and `v_huntingrifle` compile with **stock** `studiomdl`. The trade-off is stated
rather than hidden: a weight for a bone that drives no vertex is not written, so a model whose
attachment rides an unweighted bone keeps the default weight there. `studiomdl++` still
accepts the full list if you need it, with a warning.
