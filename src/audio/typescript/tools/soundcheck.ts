/**
 * Sound validation: a WAV that decodes and is L4D2's shape, or a soundscript whose every
 * named wave exists. `read_wav`/`read_soundscript` expose the facts; this turns them into a
 * pass/warn/fail before an addon is packed.
 */
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readWavTool } from "./wav.js";
import { readSoundscriptTool } from "./soundscripts.js";

const FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
});

export const checkSoundTool = defineTool({
  name: "check_sound",
  description:
    "Checks a .wav or a soundscript. A WAV must decode and be 16-bit PCM at 22050/44100 Hz, " +
    "mono or stereo; a compressed or 8-bit wave is named. A soundscript is read through the " +
    "same reader as `read_soundscript`, and every sound whose wave file is absent is a " +
    "warning. Needs the Python sidecar for the actual read.",
  realm: "local",
  inputSchema: {
    path: z.string().describe("A .wav or soundscript .txt, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    kind: z.enum(["wav", "soundscript"]),
    overall: z.enum(["pass", "warn", "fail"]),
    findings: z.array(FINDING),
    counts: z.object({ error: z.number(), warning: z.number(), info: z.number() }),
    sounds: z.number(),
    waves: z.number(),
    missingWaves: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const extension = extname(path).toLowerCase();
    const findings: Array<z.infer<typeof FINDING>> = [];
    let sounds = 0;
    let waves = 0;
    const missingWaves: string[] = [];
    let kind: "wav" | "soundscript";

    if (extension === ".wav") {
      kind = "wav";
      const result = (await readWavTool.handler({ path } as never, ctx as never)) as {
        read?: boolean;
        gameReady?: boolean;
        formatName?: string;
        channels?: number;
        sampleRate?: number;
        bitsPerSample?: number;
        readError?: string;
        note?: string;
      };
      if (!result.read) {
        findings.push({
          severity: "error",
          rule: "wav-read",
          message: result.readError ?? "the WAV did not decode",
        });
      } else {
        sounds = 1;
        if (result.gameReady === false) {
          findings.push({
            severity: "warning",
            rule: "wav-not-game-ready",
            message:
              `${result.formatName ?? "format"} ${result.bitsPerSample ?? "?"}-bit ` +
              `${result.sampleRate ?? "?"} Hz ${result.channels ?? "?"} ch is not L4D2's ` +
              `16-bit PCM 22050/44100 shape`,
          });
        } else {
          findings.push({
            severity: "info",
            rule: "wav-game-ready",
            message: result.note ?? "the WAV is in the shape L4D2 decodes",
          });
        }
      }
    } else if (extension === ".txt") {
      kind = "soundscript";
      const result = (await readSoundscriptTool.handler(
        { path, limit: 10_000 } as never,
        ctx as never,
      )) as {
        read?: boolean;
        mountError?: string;
        sounds?: Array<{ name: string; waves?: Array<{ file?: string | null; exists?: boolean }> }>;
        problems?: string[];
      };
      if (!result.read) {
        findings.push({
          severity: "error",
          rule: "soundscript-read",
          message: result.mountError ?? "the soundscript did not read",
        });
      } else {
        sounds = result.sounds?.length ?? 0;
        for (const sound of result.sounds ?? []) {
          for (const wave of sound.waves ?? []) {
            waves += 1;
            if (wave.exists === false) {
              missingWaves.push(wave.file ?? "(unnamed)");
              findings.push({
                severity: "warning",
                rule: "soundscript-wave-missing",
                message: `${sound.name}: ${wave.file ?? "(unnamed)"} was not found`,
              });
            }
          }
        }
        for (const problem of result.problems ?? []) {
          findings.push({ severity: "warning", rule: "soundscript-problem", message: problem });
        }
      }
    } else {
      throw new Error("check_sound takes a .wav or a soundscript .txt");
    }

    const counts = {
      error: findings.filter((finding) => finding.severity === "error").length,
      warning: findings.filter((finding) => finding.severity === "warning").length,
      info: findings.filter((finding) => finding.severity === "info").length,
    };
    return {
      path,
      kind,
      overall: counts.error > 0 ? ("fail" as const) : counts.warning > 0 ? ("warn" as const) : ("pass" as const),
      findings,
      counts,
      sounds,
      waves,
      missingWaves,
    };
  },
});

export const soundCheckTools = [checkSoundTool];
