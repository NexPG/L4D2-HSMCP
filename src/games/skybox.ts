/**
 * Whether a skyname names a sky the configured game actually ships.
 *
 * `write_vmf` picks `sky_day01_01` by default -- Source's own -- and on the install this
 * repository is developed against, vbsp answers every compile with two `*** Error:` lines
 * about it: the vtf files "weren't compiled with the same size texture and/or same flags",
 * so it cannot build a default cubemap. Harmless, graded `info` by `read_compile_log`, fixed
 * by `buildcubemaps` in game -- and three separate builders have now spent a moment reading
 * those two lines before concluding they did not matter (issue #62).
 *
 * The tool that *chose* the value is the one that could have checked it. This is that check.
 *
 * ## What it proves, and what it does not
 *
 * It proves the six sides exist, by mounting the same VPK-and-loose chain the engine reads
 * through. It does **not** prove they will build a cubemap: that is a statement about the
 * `.vtf` headers -- dimensions and flags across the six faces -- which nothing in this server
 * reads today. So a sky can pass here and still produce those two lines, and the note says so
 * rather than implying a guarantee it has not earned.
 */
import { callSidecar } from "../sidecar/client.js";
import type { Config } from "../config.js";

/** The six faces Source derives from a skyname, in the order the engine names them. */
export const SKY_SIDES = ["rt", "lf", "bk", "ft", "up", "dn"] as const;

const SKY_FACE = /^materials\/skybox\/(.+?)(?:_(hdr|ldr))?(rt|lf|bk|ft|up|dn)(?:_(hdr|ldr))?\.vmt$/i;

export interface SkyboxCheck {
  /** False when there was no game to look in, or the sidecar could not mount it. */
  checked: boolean;
  /** Null when `checked` is false: absent is not the same answer as unknown. */
  found: boolean | null;
  /** The sides that are missing, when some are. */
  missingSides: string[];
  /** The LDR face set is complete. A sky may be HDR-only. */
  ldrComplete: boolean | null;
  /** The HDR face set is complete. */
  hdrComplete: boolean | null;
  /** The name to store in worldspawn; a bare base gets `_hdr` when that set exists. */
  suggested: string;
  /** A few complete skies the game does have, for a caller that has to pick another. */
  alternatives: string[];
  note: string;
}

const unchecked = (why: string): SkyboxCheck => ({
  checked: false,
  found: null,
  missingSides: [],
  ldrComplete: null,
  hdrComplete: null,
  suggested: "",
  alternatives: [],
  note: why,
});

/**
 * Looks the sky up in the game's own content.
 *
 * One search, not six: `search_content` walks the whole mounted filesystem per call and
 * caches nothing, so a call per face would cost six walks to answer one question.
 */
export async function checkSkybox(
  skyname: string,
  gameDir: string | null,
  config: Config,
): Promise<SkyboxCheck> {
  if (!skyname.trim()) return unchecked("no skyname to check");
  if (!gameDir) {
    return unchecked(
      "no game profile is configured, so the sky was not checked: read_game_content and " +
        "this share one mount, and neither invents a directory to look in.",
    );
  }

  let result: Record<string, unknown>;
  try {
    result = (await callSidecar(
      "search_content",
      { gameDir, pattern: "skybox/*", kind: "material", limit: 1000 },
      config,
      120_000,
    )) as Record<string, unknown>;
  } catch (err) {
    // Never fatal. A map is still a map without a verified sky, and failing the write
    // because the Python sidecar is absent would make this tool useless on a machine that
    // has no game installed at all.
    return unchecked(
      `the sky was not checked: ${err instanceof Error ? err.message : String(err)}. ` +
        `That is about this machine, not about the map.`,
    );
  }

  if (result.mounted !== true) {
    return unchecked(
      `the sky was not checked: the game's content could not be mounted` +
        (typeof result.mountError === "string" ? ` (${result.mountError})` : ``) +
        `. Nothing was searched, so an empty answer would have said nothing about the game.`,
    );
  }

  const faces = new Map<string, Set<string>>();
  for (const row of (result.results as Array<{ path?: string }> | undefined) ?? []) {
    const m = SKY_FACE.exec((row.path ?? "").toLowerCase());
    if (!m) continue;
    const base = m[1]!;
    const mode = (m[2] || m[4] || "").toLowerCase();
    // The engine asks for `<skyname><side>.vmt`, and a stock L4D2 map carries
    // `sky_l4d_c1_1_hdr` in worldspawn, not `sky_l4d_c1_1`. The mode infix is part of the
    // name the map must store; stripping it here is how the checker used to bless a name
    // the engine could never find.
    const prefix = mode ? `${base}_${mode}` : base;
    (faces.get(prefix) ?? faces.set(prefix, new Set()).get(prefix)!).add(m[3]!);
  }

  const completePrefixes = [...faces.entries()]
    .filter(([, s]) => SKY_SIDES.every((side) => s.has(side)))
    .map(([name]) => name);
  const complete = (name: string): boolean => completePrefixes.includes(name);

  const lower = skyname.toLowerCase();
  const parts = /^(.+)_(hdr|ldr)$/.exec(lower);
  const base = parts?.[1] ?? lower;
  const ldrComplete = complete(`${base}_ldr`) || complete(lower) && !parts;
  const hdrComplete = complete(`${base}_hdr`);
  // Prefer the HDR name: every stock L4D2 campaign map stores `_hdr`, and a dual-mode VMT
  // falls back to its `_ldr` set on a renderer that cannot do HDR.
  const suggested = complete(lower)
    ? lower
    : hdrComplete
      ? `${base}_hdr`
      : ldrComplete
        ? `${base}_ldr`
        : lower;

  const have = faces.get(lower) ?? new Set<string>();
  const missingSides = SKY_SIDES.filter((side) => !have.has(side));
  const found = missingSides.length === 0;
  const mode =
    found && parts?.[2] === "hdr" && ldrComplete
      ? "It has complete HDR faces and an LDR set."
      : found && parts?.[2] === "hdr"
        ? "It has HDR faces only; an LDR renderer has no sky unless the VMT falls back."
        : found && parts?.[2] === "ldr"
          ? "It has LDR faces only; HDR mode has no sky."
          : found
            ? "It has unsuffixed faces; stock L4D2 maps store `_hdr` or `_ldr` in worldspawn."
            : "";

  const truncated = result.truncated === true;
  const caveat =
    ` Present is not the same as usable: whether the six faces share a size and flags -- ` +
    `which is what vbsp needs to build a default cubemap -- lives in the .vtf headers, ` +
    `which nothing here reads. A sky can pass this check and still draw the two 'default ` +
    `cubemap' lines that read_compile_log grades as info.`;

  return {
    checked: true,
    found,
    missingSides: [...missingSides],
    ldrComplete,
    hdrComplete,
    suggested,
    alternatives: found
      ? []
      : completePrefixes.filter((n) => n !== lower).slice(0, 5),
    note: found
      ? `The game has all six sides of skybox/${lower}. ${mode}` + caveat
      : `The game has no skybox/${lower}${have.size > 0 ? ` (${[...have].join(", ")})` : ``}: ` +
        `${missingSides.length} of its six sides are missing (${missingSides.join(", ")}). ` +
        `L4D2 asks for skybox/<skyname><side>.vmt, so a base name without \`_hdr\` or ` +
        `\`_ldr\` finds nothing.` +
        (suggested !== lower ? ` Use \`${suggested}\`.` : ``) +
        (completePrefixes.length > 0
          ? ` Complete sky names: ${completePrefixes.slice(0, 5).join(", ")}` +
            (completePrefixes.length > 5 ? ` (${completePrefixes.length} in all).` : `.`)
          : ` This game ships no complete sky at all, which is itself worth knowing.`) +
        (truncated ? ` The search was truncated, so that list is partial.` : ``),
  };
}
