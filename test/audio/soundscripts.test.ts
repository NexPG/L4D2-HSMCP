/**
 * Soundscripts: names, waves, #base, and the stock game's manifest.
 *
 * The stock case is the oracle — 13k names across 45 scripts, with wave characters and
 * `rndwave` lists — and the loose cases pin what the writer appends. The failure this
 * prevents is silent: a script that parses but names a wave that is not there, or a writer
 * that rewrites the file and drops the entry above the one it added.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { config, has } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-sounds-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Sound {
  name: string;
  script: string;
  channel: string | null;
  waves: { wave: string; file: string | null; sentence: boolean; characters: string; exists?: boolean }[];
}

interface ReadResult {
  read: boolean;
  mounted?: boolean;
  scripts?: string[];
  scriptCount?: number;
  count?: number;
  total?: number;
  duplicates?: number;
  problems?: string[];
  sounds?: Sound[];
  readError?: string;
}

const installed = has.sidecar;

describe.skipIf(!installed)("read_soundscript / write_soundscript", () => {
  it("writes one entry, reads it back and strips a sound character into the file path", async () => {
    const dir = join(scratch, "loose");
    mkdirSync(join(dir, "sound", "myaddon"), { recursive: true });
    writeFileSync(join(dir, "sound", "myaddon", "tone.wav"), Buffer.alloc(44));
    const path = join(dir, "my_sounds.txt");

    const written = await callSidecar<{ written: boolean; verified: boolean; name: string }>(
      "soundscript_write",
      { path, name: "MyAddon.Tone", wave: ">myaddon/tone.wav", channel: "CHAN_STATIC" },
      config,
    );
    expect(written.written).toBe(true);
    expect(written.verified).toBe(true);

    const read = await callSidecar<ReadResult>("soundscript_read", { path }, config);
    expect(read.read).toBe(true);
    expect(read.count).toBe(1);
    const sound = read.sounds![0]!;
    // KeyValues names are case-insensitive and srctools normalises them.
    expect(sound.name).toBe("myaddon.tone");
    expect(sound.channel).toBe("CHAN_STATIC");
    expect(sound.waves[0]!.file).toBe("sound/myaddon/tone.wav");
    expect(sound.waves[0]!.characters).toBe(">");
    expect(sound.waves[0]!.exists).toBe(true);
  });

  it("appends instead of rewriting, and refuses a duplicate name", async () => {
    const path = join(scratch, "append.txt");
    writeFileSync(path, '// keep this comment\n"Existing" {\n\t"wave" "old.wav"\n}\n');
    const before = '// keep this comment\n"Existing" {\n\t"wave" "old.wav"\n}\n';

    await callSidecar(
      "soundscript_write",
      { path, name: "MyAddon.New", wave: "myaddon/new.wav" },
      config,
    );
    const read = await callSidecar<ReadResult>("soundscript_read", { path }, config);
    expect(read.sounds!.map((s) => s.name).sort()).toEqual(["existing", "myaddon.new"]);

    // The comment and the original block survived: the writer appended, not re-exported.
    const kept = readFileSync(path, "utf8");
    expect(kept).toContain("// keep this comment");
    expect(kept).toContain('"Existing"');

    await expect(
      callSidecar("soundscript_write", { path, name: "MyAddon.New", wave: "other.wav" }, config),
    ).rejects.toThrow(/already defines/);
  });

  it("follows #base, because a real script is a tree of files", async () => {
    const dir = join(scratch, "base");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "base.txt"),
      '"Base.Sound"\n{\n\t"channel" "CHAN_STATIC"\n\t"wave" "base.wav"\n}\n',
    );
    const path = join(dir, "main.txt");
    writeFileSync(path, '#base "base.txt"\n"Main.Sound"\n{\n\t"wave" "main.wav"\n}\n');

    const read = await callSidecar<ReadResult>("soundscript_read", { path }, config);
    expect(read.read).toBe(true);
    expect(read.sounds!.map((s) => s.name).sort()).toEqual(["base.sound", "main.sound"]);
  });

  it("reads an rndwave list and reports each candidate", async () => {
    const path = join(scratch, "rnd.txt");
    writeFileSync(
      path,
      [
        '"Random.Hit"',
        "{",
        '\t"rndwave"',
        "\t{",
        '\t\t"wave" "hit1.wav"',
        '\t\t"wave" "hit2.wav"',
        "\t}",
        "}",
        "",
      ].join("\n"),
    );
    const read = await callSidecar<ReadResult>("soundscript_read", { path }, config);
    const waves = read.sounds![0]!.waves;
    expect(waves.map((w) => w.file)).toEqual(["sound/hit1.wav", "sound/hit2.wav"]);
  });

  it.skipIf(!has.gameContent)("reads the stock manifest: thousands of names, real waves", async () => {
    const read = await callSidecar<ReadResult>(
      "soundscript_read",
      { gameDir: config.gameDir, name: "rifle.fire", limit: 5 },
      config,
      300_000,
    );
    expect(read.read).toBe(true);
    expect(read.mounted).toBe(true);
    expect(read.scriptCount).toBeGreaterThan(20);
    expect(read.total).toBeGreaterThan(1000);
    expect((read.problems ?? []).length).toBeLessThan(20);

    const rifle = read.sounds!.find((s) => s.name === "rifle.fire")!;
    expect(rifle.channel).toBe("CHAN_WEAPON");
    expect(rifle.waves.length).toBeGreaterThan(0);
    expect(rifle.waves[0]!.exists).toBe(true);
    expect(rifle.waves[0]!.file).toMatch(/^sound\/weapons\/rifle\//);
  });
});
