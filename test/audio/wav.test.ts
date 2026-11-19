/**
 * WAV read and conversion.
 *
 * The conversion is checked against arithmetic, not against itself: a 4410-frame file at
 * 44100 Hz becomes 2205 frames at 22050, both channels of a stereo sine become one, and the
 * written header is read back. The negative cases are the ones that make a sound fail on a
 * player's machine — compressed WAV and a truncated chunk.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { config, has } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-wav-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface WavSpec {
  channels: number;
  rate: number;
  bits: 8 | 16;
  frames: number;
  tag?: number;
  loop?: [number, number];
}

function wav(spec: WavSpec): Buffer {
  const { channels, rate, bits, frames } = spec;
  const blockAlign = channels * (bits / 8);
  const dataBytes = frames * blockAlign;
  const data = Buffer.alloc(dataBytes);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.sin((2 * Math.PI * 440 * frame) / rate);
    for (let channel = 0; channel < channels; channel += 1) {
      if (bits === 16) {
        data.writeInt16LE(Math.round(value * 20000), frame * blockAlign + channel * 2);
      } else {
        data.writeUInt8(Math.round(128 + value * 100), frame * blockAlign + channel);
      }
    }
  }
  let smpl = Buffer.alloc(0);
  if (spec.loop) {
    smpl = Buffer.alloc(8 + 60);
    smpl.write("smpl", 0, "latin1");
    smpl.writeUInt32LE(60, 4);
    smpl.writeUInt32LE(1, 8 + 28); // one sample loop
    smpl.writeUInt32LE(spec.loop[0], 8 + 44); // start
    smpl.writeUInt32LE(spec.loop[1], 8 + 48); // end
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + dataBytes + smpl.length, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(spec.tag ?? 1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, data, smpl]);
}

interface ReadResult {
  read: boolean;
  formatName: string;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  frames: number;
  duration: number;
  gameReady: boolean;
  loop: { start: number; end: number } | null;
  readError?: string;
}

const installed = has.sidecar;

describe.skipIf(!installed)("read_wav / convert_wav", () => {
  it("reads a stereo 44.1 kHz file as game-ready", async () => {
    const path = join(scratch, "tone.wav");
    writeFileSync(path, wav({ channels: 2, rate: 44100, bits: 16, frames: 4410 }));
    const read = await callSidecar<ReadResult>("wav_read", { path }, config);
    expect(read.read).toBe(true);
    expect(read.formatName).toBe("PCM");
    expect(read.channels).toBe(2);
    expect(read.sampleRate).toBe(44100);
    expect(read.bitsPerSample).toBe(16);
    expect(read.frames).toBe(4410);
    expect(read.duration).toBeCloseTo(0.1, 4);
    expect(read.gameReady).toBe(true);
    expect(read.loop).toBeNull();
  });

  it("converts to mono 22050 with the frame count the ratio predicts", async () => {
    const path = join(scratch, "tone2.wav");
    const out = join(scratch, "tone2_mono.wav");
    writeFileSync(path, wav({ channels: 2, rate: 44100, bits: 16, frames: 4410 }));

    const converted = await callSidecar<{
      written: boolean;
      frames: number;
      sampleRate: number;
      channels: number;
      duration: number;
      peak: number;
      rms: number;
      verified: boolean;
    }>("wav_convert", { path, out, output: out, sampleRate: 22050, channels: 1 }, config);
    expect(converted.written).toBe(true);
    expect(converted.channels).toBe(1);
    expect(converted.sampleRate).toBe(22050);
    expect(converted.frames).toBe(2205);
    expect(converted.duration).toBeCloseTo(0.1, 3);
    expect(converted.peak).toBeGreaterThan(0.5);
    expect(converted.rms).toBeGreaterThan(0.1);
    expect(converted.verified).toBe(true);

    const back = await callSidecar<ReadResult>("wav_read", { path: out }, config);
    expect(back.channels).toBe(1);
    expect(back.frames).toBe(2205);
    expect(back.gameReady).toBe(true);
    // The written file is a real 16-bit PCM WAV, not just a header.
    expect(readFileSync(out).length).toBe(44 + 2205 * 2);
  });

  it("reads 8-bit PCM as not game-ready and converts it", async () => {
    const path = join(scratch, "eight.wav");
    writeFileSync(path, wav({ channels: 1, rate: 11025, bits: 8, frames: 1103 }));
    const read = await callSidecar<ReadResult>("wav_read", { path }, config);
    expect(read.bitsPerSample).toBe(8);
    expect(read.gameReady).toBe(false);

    const out = join(scratch, "eight16.wav");
    const converted = await callSidecar<{ frames: number; verified: boolean; peak: number }>(
      "wav_convert",
      { path, out, output: out, sampleRate: 22050, channels: 1 },
      config,
    );
    expect(converted.frames).toBe(2206);
    expect(converted.peak).toBeGreaterThan(0.5);
    expect(converted.verified).toBe(true);
  });

  it("names a compressed WAV instead of decoding it as noise", async () => {
    const path = join(scratch, "adpcm.wav");
    writeFileSync(path, wav({ channels: 1, rate: 22050, bits: 16, frames: 100, tag: 2 }));
    const read = await callSidecar<ReadResult>("wav_read", { path }, config);
    expect(read.read).toBe(true);
    expect(read.formatName).toBe("0x0002");
    expect(read.gameReady).toBe(false);

    await expect(
      callSidecar("wav_convert", { path, output: join(scratch, "adpcm_out.wav") }, config),
    ).rejects.toThrow(/compressed/);
  });

  it("scales a smpl loop with the sample rate and can drop it", async () => {
    const path = join(scratch, "looped.wav");
    writeFileSync(
      path,
      wav({ channels: 1, rate: 44100, bits: 16, frames: 4410, loop: [1000, 2000] }),
    );
    const source = await callSidecar<ReadResult & { loop: { start: number; end: number } | null }>(
      "wav_read",
      { path },
      config,
    );
    expect(source.loop).toEqual({ start: 1000, end: 2000 });

    const out = join(scratch, "looped_22.wav");
    const converted = await callSidecar<{
      loop: { start: number; end: number } | null;
      frames: number;
      verified: boolean;
    }>("wav_convert", { path, output: out, sampleRate: 22050, channels: 1 }, config);
    expect(converted.verified).toBe(true);
    expect(converted.frames).toBe(2205);
    expect(converted.loop).toEqual({ start: 500, end: 1000 });

    const back = await callSidecar<{ loop: { start: number; end: number } | null }>(
      "wav_read",
      { path: out },
      config,
    );
    expect(back.loop).toEqual({ start: 500, end: 1000 });

    const dropped = await callSidecar<{ loop: { start: number; end: number } | null }>(
      "wav_convert",
      { path, output: join(scratch, "looped_drop.wav"), keepLoop: false },
      config,
    );
    expect(dropped.loop).toBeNull();
  });

  it("reports a truncated chunk rather than reading past it", async () => {
    const path = join(scratch, "short.wav");
    const good = wav({ channels: 1, rate: 22050, bits: 16, frames: 100 });
    writeFileSync(path, good.subarray(0, good.length - 20));
    const read = await callSidecar<ReadResult>("wav_read", { path }, config);
    expect(read.read).toBe(false);
    expect(read.readError).toMatch(/truncated/);
  });
});
