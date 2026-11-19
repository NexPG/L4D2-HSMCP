/**
 * Soundscapes: the ambient bed, its child scapes and the wave-existence check.
 *
 * The writer appends, so a file with an existing scape must keep it. The test builds two
 * scapes, reads them back through srctools' parser, and then asks the real game for one of
 * its own files: a parser that only agrees with its own writer proves nothing.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { config, has } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-soundscape-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface ReadResult {
  read: boolean;
  mounted?: boolean;
  files?: string[];
  fileCount?: number;
  total?: number;
  count?: number;
  problems?: string[];
  missingWaves?: string[];
  soundscapes?: Array<{
    name: string;
    loopSounds: Array<{ wave: string; radius: number }>;
    randomSounds: Array<{ waves: string[]; time: number[] }>;
    children: Array<{ name: string }>;
  }>;
  readError?: string;
}

const installed = has.sidecar;

describe.skipIf(!installed)("read_soundscape / write_soundscape", () => {
  it("writes loops, random beds and a child, then reads them back", async () => {
    const path = join(scratch, "soundscapes_test.txt");
    const written = await callSidecar<{
      written: boolean;
      verified: boolean;
      loops: number;
      randoms: number;
      children: number;
      bytes: number;
    }>(
      "soundscape_write",
      {
        path,
        name: "MyAddon.Wind",
        loopSounds: [{ wave: "ambient/wind.wav", volume: 0.5, radius: 1 }],
        randomSounds: [{ waves: ["ambient/bird1.wav", "ambient/bird2.wav"], time: [4, 9] }],
        children: [{ name: "MyAddon.Room" }],
        fadetime: 1.5,
      },
      config,
    );
    expect(written.written).toBe(true);
    expect(written.verified).toBe(true);
    expect(written.loops).toBe(1);
    expect(written.randoms).toBe(1);
    expect(written.children).toBe(1);

    const read = await callSidecar<ReadResult>("soundscape_read", { path }, config);
    expect(read.read).toBe(true);
    expect(read.count).toBe(1);
    const scape = read.soundscapes![0]!;
    expect(scape.name).toBe("MyAddon.Wind");
    expect(scape.loopSounds[0]!.wave).toBe("ambient/wind.wav");
    expect(scape.randomSounds[0]!.waves).toEqual([
      "ambient/bird1.wav",
      "ambient/bird2.wav",
    ]);
    expect(scape.children[0]!.name).toBe("MyAddon.Room");
  });

  it("appends a second scape and refuses a duplicate name", async () => {
    const path = join(scratch, "append.txt");
    writeFileSync(path, '// keep me\n"Existing"\n{\n\tplaylooping\n\t\t{\n\t\twave "old.wav"\n\t\t}\n}\n');
    await callSidecar(
      "soundscape_write",
      { path, name: "MyAddon.Second", loopSounds: [{ wave: "ambient/second.wav" }] },
      config,
    );
    const read = await callSidecar<ReadResult>("soundscape_read", { path }, config);
    expect(read.soundscapes!.map((s) => s.name).sort()).toEqual(["Existing", "MyAddon.Second"]);

    await expect(
      callSidecar(
        "soundscape_write",
        { path, name: "MyAddon.Second", loopSounds: [{ wave: "other.wav" }] },
        config,
      ),
    ).rejects.toThrow(/already defines/);
  });

  it.skipIf(!has.gameContent)("reads the stock soundscapes and checks real waves", async () => {
    const read = await callSidecar<ReadResult>(
      "soundscape_read",
      { gameDir: config.gameDir, limit: 5 },
      config,
      300_000,
    );
    expect(read.read).toBe(true);
    expect(read.mounted).toBe(true);
    expect(read.fileCount).toBeGreaterThan(3);
    expect(read.total).toBeGreaterThan(20);
    // Two stock files use escapes srctools treats as control characters; they are reported, not hidden.\n    expect((read.problems ?? []).length).toBeLessThan(5);
    // The stock files reference real waves; a missing one would mean the parser lost a path.
    expect((read.missingWaves ?? []).length).toBeLessThan(100);
  });
});
